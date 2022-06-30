const { assert, expect } = require("chai");
const { network, getNamedAccounts, deployments, ethers } = require("hardhat");
const { developmentChain, networkConfig } = require("../../helper-hardhat-config");

!developmentChain.includes(network.name)
    ? describe.skip
    : describe("Lottery Unit Tests", () => {
          let lottery, vrfCoordinatorV2Mock, deployer, lotteryEnteranceFee, interval;
          const chainId = network.config.chainId;
          beforeEach(async () => {
              deployer = (await getNamedAccounts()).deployer;
              await deployments.fixture(["all"]);
              lottery = await ethers.getContract("Lottery", deployer);
              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer);
              lotteryEnteranceFee = await lottery.getEntryFee();
              interval = await lottery.getInterval();
          });

          describe("constructor", () => {
              it("initializes the lottery correctly", async () => {
                  const lotteryState = await lottery.getRaffleState();
                  const interval = await lottery.getInterval();
                  assert.equal(lotteryState.toString(), "0");
                  assert.equal(interval.toString(), networkConfig[chainId]["interval"]);
              });
          });

          describe("Enter Lottery", () => {
              it("It reverts when you dont pay enough", async () => {
                  await expect(lottery.enterLottery()).to.be.revertedWith(
                      "Lottery__NOTENOUGHETHENTERED"
                  );
              });
              it("It records the players when they enter", async () => {
                  await lottery.enterLottery({ value: lotteryEnteranceFee });
                  const player = await lottery.getPlayers(0);
                  assert.equal(player, deployer);
              });
              it("emits events on enter", async () => {
                  await expect(lottery.enterLottery({ value: lotteryEnteranceFee })).to.emit(
                      lottery,
                      "LotteryEnter"
                  );
              });
              it("doesnt allow enterance when lottery is calculating", async () => {
                  await lottery.enterLottery({ value: lotteryEnteranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []);
                  await lottery.performUpkeep([]);
                  await expect(
                      lottery.enterLottery({ value: lotteryEnteranceFee })
                  ).to.be.revertedWith("Lottery__NOTOPEN");
              });
          });

          describe("checkUpKeep", () => {
              it("returns false it people hasnt sent any eth", async () => {
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []);
                  const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([]);
                  assert(!upkeepNeeded);
              });
              it("returns false when lottery isnt open", async () => {
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []);
                  await lottery.enterLottery({ value: lotteryEnteranceFee });
                  await lottery.performUpkeep([]);
                  const lotteryState = await lottery.getRaffleState();
                  const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([]);
                  assert.equal(lotteryState.toString(), "1");
                  assert.equal(upkeepNeeded, false);
              });
              it("returns false if enough time hasn't passed", async () => {
                  await lottery.enterLottery({ value: lotteryEnteranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() - 1]);
                  await network.provider.request({ method: "evm_mine", params: [] });
                  const { upkeepNeeded } = await lottery.callStatic.checkUpkeep("0x");
                  assert(!upkeepNeeded);
              });
              it("returns true if enough time has passed, has players, eth, and is open", async () => {
                  await lottery.enterLottery({ value: lotteryEnteranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.request({ method: "evm_mine", params: [] });
                  const { upkeepNeeded } = await lottery.callStatic.checkUpkeep("0x");
                  assert(upkeepNeeded);
              });
          });

          describe("performUpKeep", () => {
              it("It can only run if checkupkeep is true", async () => {
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []);
                  await lottery.enterLottery({ value: lotteryEnteranceFee });
                  const tx = await lottery.performUpkeep([]);
                  assert(tx);
              });
              it("Reverts when checkupKepp is false", async () => {
                  await expect(lottery.performUpkeep([])).to.be.revertedWith(
                      "Lottery__UPKEEPNOTNEEDED"
                  );
              });
              it("updates the raffle state , emit an event , calls the vrf coordinator", async () => {
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []);
                  await lottery.enterLottery({ value: lotteryEnteranceFee });
                  const txResponse = await lottery.performUpkeep([]);
                  const txReceipt = await txResponse.wait(1);
                  const lotteryState = await lottery.getRaffleState();
                  const requestId = txReceipt.events[1].args.requestId;
                  assert(requestId.toNumber() > 0);
                  assert(lotteryState.toString() === "1");
              });
          });

          describe("Fufil Random Words", () => {
              beforeEach(async () => {
                  await lottery.enterLottery({ value: lotteryEnteranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []);
              });
              it("can only be called after performUpKeep", async () => {
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(0, lottery.address)
                  ).to.be.revertedWith("nonexistent request");
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(1, lottery.address)
                  ).to.be.revertedWith("nonexistent request");
              });
              it("Picks a winner ,resets the lottery and send money", async (done) => {
                  const additionalEntrants = 3;
                  const startingAccountIndex = 1; //deployer 0
                  const accounts = await ethers.getSigners();
                  for (
                      let i = startingAccountIndex;
                      i < additionalEntrants + startingAccountIndex;
                      i++
                  ) {
                      const accountConnectedLottery = lottery.connect(accounts[i]);
                      await accountConnectedLottery.enterLottery({ value: lotteryEnteranceFee });
                  }
                  const startingTimeStamp = await lottery.getLatestTimeStamp();

                  await new Promise(async (resolve, reject) => {
                      lottery.once("WinnerPicked", async () => {
                          console.log("found, the event");
                          try {
                              console.log(accounts[2].address);
                              console.log(accounts[0].address);
                              console.log(accounts[1].address);
                              const recentWinner = await lottery.getRecentWInner();
                              const lotteryState = await lottery.getRaffleState();
                              const endingTimeStamp = await lottery.getLatestTimeStamp();
                              const numPlayers = await lottery.getNumberOfPlayers();
                              const winnerEndingBalance = await accounts[1].getBalance();
                              assert.equal(numPlayers.toString(), "0");
                              assert.equal(lotteryState.toString(), "0");
                              assert.equal(endingTimeStamp > startingTimeStamp);
                              assert.equal(
                                  winnerEndingBalance.toString(),
                                  winnerStartingBalance.add(
                                      lotteryEnteranceFee
                                          .mul(additionalEntrants)
                                          .add(lotteryEnteranceFee)
                                          .toString()
                                  )
                              );
                              console.log(recentWinner);
                              resolve();
                          } catch (e) {
                              reject(e);
                          }
                      });
                      const tx = await raffle.performUpkeep([]);
                      console.log("Entering Lottery...");
                      const txReceipt = await tx.wait(1);
                      console.log("Ok, time to wait...");
                      const winnerStartingBalance = await accounts[1].getBalance();
                      await vrfCoordinatorV2Mock.fulfillRandomWords(
                          txReceipt.events[1].args.requestId,
                          lottery.address
                      );
                      done();
                  });
              });
          });
      });
