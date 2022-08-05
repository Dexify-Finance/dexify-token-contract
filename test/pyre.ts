import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber, Contract } from "ethers";
import { ethers, getNamedAccounts, network,  } from "hardhat";
import ERC20ABI from '../data/ERC20';
import IUniswapV2Router from '../data/IUniswapV2Router';


let token: Contract;
let uniswapV2Router: Contract;
let weth: Contract;

let _signer: SignerWithAddress;
let other1: SignerWithAddress;
let other2: SignerWithAddress;
let LIQUIDITY_HOLDER: SignerWithAddress;
let CHARITY_WALLET: SignerWithAddress;

const uniswapV2RouterAddress = "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff"; // Mainnet Pancakeswap V2 Router
let uniswapV2Pair: string;
const SWAP_UNIT = 10000000000 / 10000;

describe("PYRE", function () {

  const buyToken = async (signer: SignerWithAddress, amount: BigNumber) => {
    await weth.connect(signer).approve(uniswapV2RouterAddress, amount);
    const path = [await uniswapV2Router.WETH(), token.address];

    let tx = await uniswapV2Router.connect(signer).swapExactETHForTokensSupportingFeeOnTransferTokens(
      0,
      path,
      signer.address,
      (await ethers.provider.getBlock("latest")).timestamp + 1000,
      {
        value: amount,
      }
    );

    return tx;
  }

  const sellToken = async (signer: SignerWithAddress, amount: BigNumber) => {
    const path = [token.address, await uniswapV2Router.WETH()];
    await token.connect(signer).approve(uniswapV2RouterAddress, amount);
    
    let tx = await uniswapV2Router.connect(signer).swapExactTokensForETHSupportingFeeOnTransferTokens(
      amount.toString(),
      0, // accept any amount of ETH
      path,
      signer.address,
      (await ethers.provider.getBlock("latest")).timestamp + 1000,
    );

    return tx;
  }

  const moveTime = async (timeInSeconds: number) => {
    await network.provider.send("evm_increaseTime", [timeInSeconds]);
    await network.provider.send("hardhat_mine", ["0x1"]);
  }

  beforeEach(async () => {

    _signer = (await ethers.getSigners())[0];
    other1 = (await ethers.getSigners())[1];
    other2 = (await ethers.getSigners())[2];
    CHARITY_WALLET = (await ethers.getSigners())[3]
    LIQUIDITY_HOLDER = (await ethers.getSigners())[4];

    const contractFactory = await ethers.getContractFactory("PYRE"); 
    token = await contractFactory.deploy(CHARITY_WALLET.address, uniswapV2RouterAddress);
    await token.deployed();

    uniswapV2Router = new ethers.Contract(uniswapV2RouterAddress, IUniswapV2Router, ethers.provider);
    weth = new ethers.Contract(await uniswapV2Router.WETH(), ERC20ABI, ethers.provider);
    uniswapV2Pair = await token.uniswapV2Pair();

    // add initial liquidity (100 eth, 10**8 PYRE)
    await token.connect(_signer).approve(uniswapV2RouterAddress, ethers.utils.parseEther('10000000000'));
    await weth.connect(_signer).approve(uniswapV2RouterAddress, ethers.utils.parseEther('10000'));
    await uniswapV2Router.connect(_signer).addLiquidityETH(
        token.address,
        ethers.utils.parseEther("10000000000"),
        0, // slippage is unavoidable
        0, // slippage is unavoidable
        LIQUIDITY_HOLDER.address,
        (await ethers.provider.getBlock("latest")).timestamp + 1000,
        {
          value: ethers.utils.parseEther("10000"),
          gasLimit: 2100000,
          gasPrice: ethers.utils.parseUnits('50', 'gwei')
        }
    );

  });

  it("Deploy Contract: ", async () => {
    const balance = await token.balanceOf(_signer.address);
    const totalBalance = await token.totalSupply();
    expect(balance).to.be.equal(totalBalance.div(2).sub(ethers.utils.parseEther('10000000000'))); // minus liquidity
  });

  it("Normal Transfer: ", async() => {
    await token.transfer(other1.address, ethers.utils.parseEther('100')); // Transfer 100 $PYRE from signer to other1
    expect(await token.balanceOf(other1.address)).to.above(0);
  });

  it("Revert sell for more than 5% of total supply: ", async () => {
    const amount = 5 * 10 ** 10 + 100; // 10% of total supply;
    await token.connect(_signer).transfer(other1.address, ethers.utils.parseEther(amount.toString()));
    await expect(sellToken(other1, ethers.utils.parseEther(amount.toString()))).revertedWith('TRANSFER_FROM_FAILED');
  });

  it("Transfer between Excluded members: ", async() => {
    //Transfer from excluded
    let amount = ethers.utils.parseEther("100");
    await token.connect(_signer).transfer(other1.address, amount);
    expect(await token.balanceOf(other1.address)).to.be.equal(ethers.utils.parseEther('100')); // transfer fee is 0

    //Transfer to excluded
    await token.connect(other1).transfer(_signer.address, amount);
    expect(await token.balanceOf(other1.address)).to.be.equal(ethers.utils.parseEther('0')); // transfer fee is 0

    //Transfer both excluded
    await token.connect(_signer).excludeFromFee(other2.address);
    await token.connect(_signer).transfer(other2.address, amount);
    expect(await token.balanceOf(other2.address)).to.be.equal(ethers.utils.parseEther('100')); // transfer fee is 0
    
  });

  it("Buy Token 10%: ", async () => {
    const amount = ethers.utils.parseEther('1'); // 1 eth;
    // Buy token in 2 weeks
    let initialPoolTokenBalance = await token.balanceOf(uniswapV2Pair);

    await buyToken(other1, amount);

    let currrentPoolTokenBalance = await token.balanceOf(uniswapV2Pair);
    let currentAccountTokanBalance = await token.balanceOf(other1.address);
    let originBuyTokenAmount = initialPoolTokenBalance.sub(currrentPoolTokenBalance);

    // fee amount should be around in 10%. 
    expect(originBuyTokenAmount.div(1000).mul(900).sub(currentAccountTokanBalance).abs()).to.be.below(originBuyTokenAmount.div(1000)); // fee 10%, delta: 0.1%
  });

  it("Buy Token in 2 weeks ( < 10%)", async () => {
    const amount = ethers.utils.parseEther('1'); // 1 eth;
    const _amount = ethers.utils.parseEther('0.9'); // 1 eth;
    // Buy token in 2 weeks
    await buyToken(other1, amount);
    await moveTime(3600 * 24 * 7); // move forward 7 days

    let initialPoolTokenBalance = await token.balanceOf(uniswapV2Pair);
    let initialAccountTokenBalance = await token.balanceOf(other1.address);

    await buyToken(other1, _amount);

    let currrentPoolTokenBalance = await token.balanceOf(uniswapV2Pair);
    let feeBuyAmount = (await token.balanceOf(other1.address)).sub(initialAccountTokenBalance);
    let noFeeBuyAmount = initialPoolTokenBalance.sub(currrentPoolTokenBalance);

    // fee amount should be around in 6.5%
    expect(noFeeBuyAmount.div(1000).mul(935).sub(feeBuyAmount).abs()).to.be.below(noFeeBuyAmount.div(1000)); // fee 6.5%, delta: 0.1%
  });

  it("Buy Token after 2 weeks ( 3% )", async () => {
    const amount = ethers.utils.parseEther('1'); // 1 eth;
    const _amount = ethers.utils.parseEther('0.9'); // 1 eth;
    // Buy token in 2 weeks
    await buyToken(other1, amount);
    await moveTime(3600 * 24 * 15); // move forward 15 days

    let initialPoolTokenBalance = await token.balanceOf(uniswapV2Pair);
    let initialAccountTokenBalance = await token.balanceOf(other1.address);

    await buyToken(other1, _amount);

    let currrentPoolTokenBalance = await token.balanceOf(uniswapV2Pair);
    let feeBuyAmount = (await token.balanceOf(other1.address)).sub(initialAccountTokenBalance);
    let noFeeBuyAmount = initialPoolTokenBalance.sub(currrentPoolTokenBalance);

    // fee amount should be around in 3%
    expect(noFeeBuyAmount.div(1000).mul(970).sub(feeBuyAmount).abs()).to.be.below(noFeeBuyAmount.div(1000)); // fee 3%, delta: 0.1%
  });

  it("Buy Token more than current balance ( after 2 weeks )", async () => {
    const amount = ethers.utils.parseEther('1'); // 1 eth;
    const _amount = ethers.utils.parseEther('2'); // 2 eth;
    // Buy token in 2 weeks
    await buyToken(other1, amount);
    await moveTime(3600 * 24 * 15); // move forward 15 days

    let initialPoolTokenBalance = await token.balanceOf(uniswapV2Pair);
    let initialAccountTokenBalance = await token.balanceOf(other1.address);

    await buyToken(other1, _amount);

    let currrentPoolTokenBalance = await token.balanceOf(uniswapV2Pair);
    let feeBuyAmount = (await token.balanceOf(other1.address)).sub(initialAccountTokenBalance);

    let noFeeBuyAmount = initialPoolTokenBalance.sub(currrentPoolTokenBalance);

    // fee amount should be around in 6.85%
    expect(noFeeBuyAmount.div(10000).mul(9315).sub(feeBuyAmount).abs()).to.be.below(noFeeBuyAmount.div(1000)); // fee 6.85%, delta: 0.1%
  });

  it("Buy Token more than current balance ( in 2 weeks )", async () => {
    const amount = ethers.utils.parseEther('1'); // 1 eth;
    const _amount = ethers.utils.parseEther('2'); // 1 eth;
    // Buy token in 2 weeks
    await buyToken(other1, amount);
    await moveTime(3600 * 24 * 7); // move forward 7 days

    let initialPoolTokenBalance = await token.balanceOf(uniswapV2Pair);
    let initialAccountTokenBalance = await token.balanceOf(other1.address);

    await buyToken(other1, _amount);

    let currrentPoolTokenBalance = await token.balanceOf(uniswapV2Pair);
    let feeBuyAmount = (await token.balanceOf(other1.address)).sub(initialAccountTokenBalance);
    let noFeeBuyAmount = initialPoolTokenBalance.sub(currrentPoolTokenBalance);

    // fee amount should be around in 8.425%
    expect(noFeeBuyAmount.div(10000).mul(9157).sub(feeBuyAmount).abs()).to.be.below(noFeeBuyAmount.div(1000)); // fee 8.425%, delta: 0.1%
  });

  it("Buy Token more than current balance ( multiple transactions, out 2 weeks ) ", async () => {
    const amount = ethers.utils.parseEther('1'); // 1 eth;
    const _amount = ethers.utils.parseEther('2'); // 2 eth;
    const __amount = ethers.utils.parseEther('3'); // 3 eth; 
    // Buy token in 2 weeks
    await buyToken(other1, amount);
    await moveTime(3600 * 24 * 7); // move forward 7 days

    await buyToken(other1, _amount);
    await moveTime(3600 * 24 * 9); // move forward 9 days

    let initialPoolTokenBalance = await token.balanceOf(uniswapV2Pair);
    let initialAccountTokenBalance = await token.balanceOf(other1.address);

    await buyToken(other1, __amount);

    let currrentPoolTokenBalance = await token.balanceOf(uniswapV2Pair);
    let feeBuyAmount = (await token.balanceOf(other1.address)).sub(initialAccountTokenBalance);
    let noFeeBuyAmount = initialPoolTokenBalance.sub(currrentPoolTokenBalance);

    // fee amount should be around in 3.6%
    expect(noFeeBuyAmount.div(10000).mul(9640).sub(feeBuyAmount).abs()).to.be.below(noFeeBuyAmount.div(1000)); // fee 3.6%, delta: 0.1%
  });

  it("Buy Token more than current balance ( multiple transactions, in 2 weeks ) ", async () => {
    const amount = ethers.utils.parseEther('1'); // 1 eth;
    const _amount = ethers.utils.parseEther('2'); // 2 eth;
    const __amount = ethers.utils.parseEther('2'); // 3 eth; 
    // Buy token in 2 weeks
    await buyToken(other1, amount);
    await moveTime(3600 * 24 * 7); // move forward 7 days

    await buyToken(other1, _amount);
    await moveTime(3600 * 24 * 4); // move forward 4 days

    let initialPoolTokenBalance = await token.balanceOf(uniswapV2Pair);
    let initialAccountTokenBalance = await token.balanceOf(other1.address);

    await buyToken(other1, __amount);

    let currrentPoolTokenBalance = await token.balanceOf(uniswapV2Pair);
    let feeBuyAmount = (await token.balanceOf(other1.address)).sub(initialAccountTokenBalance);
    let noFeeBuyAmount = initialPoolTokenBalance.sub(currrentPoolTokenBalance);

    // fee amount should be around in 4.5%
    expect(noFeeBuyAmount.div(10000).mul(9550).sub(feeBuyAmount).abs()).to.be.below(noFeeBuyAmount.div(1000)); // fee 4.5%, delta: 0.1%
  });

  it("Sell Token at first ( 15%): ", async () => {
    await token.connect(_signer).transfer(other1.address, ethers.utils.parseEther(`${SWAP_UNIT}`));
    let initialAccountEthBalance = await ethers.provider.getBalance(other1.address);

    await sellToken(other1, ethers.utils.parseEther(`${SWAP_UNIT}`));
    let currentAccountEthBalance = await ethers.provider.getBalance(other1.address);

    let feeSellAmount = currentAccountEthBalance.sub(initialAccountEthBalance);
    let noFeeSellAmount = ethers.utils.parseEther("1");
    
    expect(noFeeSellAmount.mul(8500).div(10000).sub(feeSellAmount).abs()).to.be.below(noFeeSellAmount.div(500)); // fee: 15%, delta: 0.2%
  });

  it("Sell Token in 2 months (3% > < 15%): ", async () => {
    await token.connect(_signer).transfer(other1.address, ethers.utils.parseEther(`${3 * SWAP_UNIT}`));

    await moveTime(3600 * 24 * 10); // move time 30 days
    // Sell token
    await sellToken(other1, ethers.utils.parseEther(`${SWAP_UNIT}`));

    await moveTime(3600 * 24 * 20); // move time 30 days
    let initialAccountEthBalance = await ethers.provider.getBalance(other1.address);

    await sellToken(other1, ethers.utils.parseEther(`${SWAP_UNIT}`));

    let currentAccountEthBalance = await ethers.provider.getBalance(other1.address);

    let feeSellAmount = currentAccountEthBalance.sub(initialAccountEthBalance);
    let noFeeSellAmount = ethers.utils.parseEther("1");
    
    expect(noFeeSellAmount.mul(9085).div(10000).sub(feeSellAmount).abs()).to.be.below(noFeeSellAmount.div(500)); // fee: 9.098%, delta: 0.2%
  });

  it("Sell Token after 2 months ( 3%): ", async () => {

    await token.connect(_signer).transfer(other1.address, ethers.utils.parseEther(`${2 * SWAP_UNIT}`));

    let initialAccountEthBalance = await ethers.provider.getBalance(other1.address);
    // Sell token after 2 months
    await moveTime(3600 * 24 * 80); // move time 80 days
    await sellToken(other1, ethers.utils.parseEther(`${SWAP_UNIT}`));

    let currentAccountEthBalance = await ethers.provider.getBalance(other1.address);

    let feeSellAmount = currentAccountEthBalance.sub(initialAccountEthBalance);
    let noFeeSellAmount = ethers.utils.parseEther("1");
    
    expect(noFeeSellAmount.mul(9695).div(10000).sub(feeSellAmount).abs()).to.be.below(noFeeSellAmount.div(500)); // fee: 3%, delta: 0.2%
  });

  it("Buy 1, Buy 2,  Sell 2, Sell 0.5, buy 0.1, buy 2 Token : ", async () => {

    await buyToken(other1, ethers.utils.parseEther("1"));

    await moveTime(3600 * 24 * 10);
    
    await buyToken(other1, ethers.utils.parseEther("2"));

    await moveTime(3600 * 24 * 15);

    let initialAccountEthBalance = await ethers.provider.getBalance(other1.address);
    
    await sellToken(other1, ethers.utils.parseEther(`${2*SWAP_UNIT}`));
    let currentAccountEthBalance = await ethers.provider.getBalance(other1.address);

    let feeSellAmount = currentAccountEthBalance.sub(initialAccountEthBalance);
    let noFeeSellAmount = ethers.utils.parseEther("2");
    
    expect(noFeeSellAmount.mul(8890).div(10000).sub(feeSellAmount).abs()).to.be.below(noFeeSellAmount.div(500)); // fee: around 11.06%%, delta: 0.2%
    // // Sell token after 2 months
    // await moveTime(3600 * 24 * 80); // move time 80 days
    // await sellToken(other1, ethers.utils.parseEther(`${SWAP_UNIT}`));

    await moveTime(3600 * 24 * 30);

    initialAccountEthBalance = await ethers.provider.getBalance(other1.address);
    
    await sellToken(other1, ethers.utils.parseEther(`${SWAP_UNIT / 2}`));

    currentAccountEthBalance = await ethers.provider.getBalance(other1.address);

    feeSellAmount = currentAccountEthBalance.sub(initialAccountEthBalance);
    noFeeSellAmount = ethers.utils.parseEther("0.5");
    
    expect(noFeeSellAmount.mul(9380).div(10000).sub(feeSellAmount).abs()).to.be.below(noFeeSellAmount.div(500)); // fee: around 6.15%, delta: 0.2%
    
    await moveTime(3600 * 24 * 3); // 58days after first buy

    let initialAccountTokenBalance = await token.balanceOf(other1.address);
    
    await buyToken(other1, ethers.utils.parseEther(`0.1`));

    let currentAccountTokenBalance = await token.balanceOf(other1.address);

    let feeBuyAmount = currentAccountTokenBalance.sub(initialAccountTokenBalance);
    let noFeeBuyAmount = ethers.utils.parseEther(`${SWAP_UNIT/10}`);
    
    expect(noFeeBuyAmount.mul(9690).div(10000).sub(feeBuyAmount).abs()).to.be.below(noFeeBuyAmount.div(500)); // fee: around 3%, delta: 0.2%
    
  });

  it("Buy back in 2 hours less than sell amount (3%): ", async () => {

    await token.connect(_signer).transfer(other1.address, ethers.utils.parseEther(`${2 * SWAP_UNIT}`));

    // Sell token after 7 days
    await moveTime(3600 * 24 * 7); // move time 7 days
    await sellToken(other1, ethers.utils.parseEther(`${SWAP_UNIT}`));
    
    let initialAccountTokenBalance = await token.balanceOf(other1.address);

    await moveTime(3600 * 1); // move time 1 hour
    await buyToken(other1, ethers.utils.parseEther('0.7'));

    let currentAccountTokenBalance = await token.balanceOf(other1.address);
    
    let feeBuyAmount = currentAccountTokenBalance.sub(initialAccountTokenBalance);
    let noFeeBuyAmount = ethers.utils.parseEther(`${SWAP_UNIT * 7 /10}`);
    
    expect(noFeeBuyAmount.mul(9690).div(10000).sub(feeBuyAmount).abs()).to.be.below(noFeeBuyAmount.div(500)); // fee: around 3%, delta: 0.2%
  });

  it("Buy back in 2 hours more than sell amount (>3%): ", async () => {

    await token.connect(_signer).transfer(other1.address, ethers.utils.parseEther(`${2 * SWAP_UNIT}`));

    // Sell token after 7 days
    await moveTime(3600 * 24 * 7); // move time 7 days
    await sellToken(other1, ethers.utils.parseEther(`${SWAP_UNIT}`));
    
    let initialAccountTokenBalance = await token.balanceOf(other1.address);

    await moveTime(3600 * 1); // move time 1 hour
    await buyToken(other1, ethers.utils.parseEther('1.5'));

    let currentAccountTokenBalance = await token.balanceOf(other1.address);
    
    let feeBuyAmount = currentAccountTokenBalance.sub(initialAccountTokenBalance);
    let noFeeBuyAmount = ethers.utils.parseEther(`${SWAP_UNIT * 3/2}`);
    
    expect(noFeeBuyAmount.mul(9580).div(10000).sub(feeBuyAmount).abs()).to.be.below(noFeeBuyAmount.div(500)); // fee: around 4.16%, delta: 0.2%
  });

  it("Buy back in 2 hours less than sell amount (2 sell, 1.5 buy) (3%): ", async () => {

    await token.connect(_signer).transfer(other1.address, ethers.utils.parseEther(`${3 * SWAP_UNIT}`));

    // Sell token after 7 days
    await moveTime(3600 * 24 * 7); // move time 7 days
    await sellToken(other1, ethers.utils.parseEther(`${SWAP_UNIT}`));
    
    await moveTime(3600 * 0.5); // move time 30 min
    await sellToken(other1, ethers.utils.parseEther(`${SWAP_UNIT}`));

    let initialAccountTokenBalance = await token.balanceOf(other1.address);

    await moveTime(3600 * 1); // move time 1 hour
    await buyToken(other1, ethers.utils.parseEther('1.5'));

    let currentAccountTokenBalance = await token.balanceOf(other1.address);
    
    let feeBuyAmount = currentAccountTokenBalance.sub(initialAccountTokenBalance);
    let noFeeBuyAmount = ethers.utils.parseEther(`${SWAP_UNIT * 3/2}`);
    
    expect(noFeeBuyAmount.mul(9690).div(10000).sub(feeBuyAmount).abs()).to.be.below(noFeeBuyAmount.div(500)); // fee: 3%, delta: 0.2%
  });

  it("Buy back in 2 hours more than sell amount (2 sell, 3.5 buy) (>3%): ", async () => {

    await token.connect(_signer).transfer(other1.address, ethers.utils.parseEther(`${3 * SWAP_UNIT}`));

    // Sell token after 7 days
    await moveTime(3600 * 24 * 7); // move time 7 days
    await sellToken(other1, ethers.utils.parseEther(`${SWAP_UNIT}`));
    
    await moveTime(3600 * 0.5); // move time 30 min
    await sellToken(other1, ethers.utils.parseEther(`${SWAP_UNIT}`));

    let initialAccountTokenBalance = await token.balanceOf(other1.address);

    await moveTime(3600 * 1); // move time 1 hour
    await buyToken(other1, ethers.utils.parseEther('3.5'));

    let currentAccountTokenBalance = await token.balanceOf(other1.address);
    
    let feeBuyAmount = currentAccountTokenBalance.sub(initialAccountTokenBalance);
    let noFeeBuyAmount = ethers.utils.parseEther(`${SWAP_UNIT * 3.5}`);
    
    expect(noFeeBuyAmount.mul(9495).div(10000).sub(feeBuyAmount).abs()).to.be.below(noFeeBuyAmount.div(500)); // fee: 5%, delta: 0.2%
  });

  it('Test custom scenario: Buy 10M PYRE, buy 100M pyre after 2 months, sell 9M pyre after 1 day', async () => {
    // Buy 10M
    await buyToken(other1, ethers.utils.parseEther(`${10 ** 7 / SWAP_UNIT}`));

    await moveTime(3600 * 24 * 61); // move time 2 months

    // Buy 100M
    await buyToken(other1, ethers.utils.parseEther(`${10 ** 8 / SWAP_UNIT}`));

    await moveTime(3600 * 24); // move time 1 day

    const initialEthBalance = await ethers.provider.getBalance(other1.address);
    // Sell 9M
    const sellAmount = ethers.utils.parseEther(`${9 * 10 ** 6}`);
    await sellToken(other1, sellAmount);
    
    const currentAccountEthBalance = await ethers.provider.getBalance(other1.address);
    
    // now the rate betweek PYRE and BNB: 10000000000/10000 => 1M PYRE : 1 BNB
    //expected income : around 8.73M => around 8.73 BNB
    const delta = currentAccountEthBalance.sub(initialEthBalance);
    const tokenAmount = await token.balanceOf(other1.address);

  });
});
