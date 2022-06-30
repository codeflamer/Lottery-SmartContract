const { assert, expect } = require("chai");
const { network, getNamedAccounts, ethers } = require("hardhat");
const { developmentChain } = require("../../helper-hardhat-config");

developmentChain.includes(network.name)
    ? describe.skip
    : describe("Raffle Staging Test", function () {
          console.log("meeeeeeeeee");
          let lottery, deployer, entranceFee;

          beforeEach(async () => {
              deployer = (await getNamedAccounts()).deployer;
              lottery = await ethers.getContract("Lottery", deployer);
              entranceFee = await lottery.getEntryFee();
          });

          describe("constructor", () => {
              it("initializes the lottery correctly", async () => {
                  const lotteryState = await lottery.getRaffleState();
                  //   const interval = await lottery.getInterval();
                  assert.equal(lotteryState.toString(), "0");
                  //   assert.equal(interval.toString(), networkConfig[chainId]["interval"]);
              });
          });

          describe("fulfillRandomWords", () => {
              console.log("sdsdsdd");
              it("", async () => {
                  console.log("Setting up test...");
                  const startingTimeStamp = await lottery.getLatestTimeStamp();
                  const accounts = await ethers.getSigners();

                  await new Promise(async (resolve, reject) => {
                      lottery.once("WinnerPicked", async () => {
                          console.log("Winner event Fired!!!!!");
                          try {
                              const recentWinner = await lottery.getRecentWInner();
                              const raffleState = await lottery.getRaffleState();
                              const winnerBalance = await accounts[0].getBalance();
                              const endingTimeStamp = await lottery.getLatestTimeStamp();
                              assert.equal(raffleState.toString(), "0");
                              assert(startingTimeStamp < endingTimeStamp);
                              await expect(lottery.getPlayer(0)).to.be.reverted;
                              assert.equal(recentWinner.toString(), accounts[0].address);
                              assert.equal(
                                  winnerBalance.toString(),
                                  winnerStartingBalance.add(entranceFee).toString()
                              );
                              resolve();
                          } catch (e) {
                              reject(e);
                          }
                      });
                      console.log("Entering Lottery...");
                      const tx = await lottery.enterLottery({ value: entranceFee });
                      await tx.wait(1);
                      console.log("Ok, time to wait...");
                      const winnerStartingBalance = await accounts[0].getBalance();
                  });
              });
          });
      });
