import { DeployFunction } from 'hardhat-deploy/types';

const fn: DeployFunction = async function ({ deployments: { deploy }, ethers: { getSigners }, network }) {
  const deployer = (await getSigners())[0];

  const contractDeployed = await deploy('Dexify', {
    from: deployer.address,
    log: true,
    skipIfAlreadyDeployed: true,
    args: [
        deployer.address
    ]
  });
  console.log('npx hardhat verify --network '+ network.name +  ' ' + contractDeployed.address);

};
fn.skip = async (hre) => {
  return false;
  // Skip this on ropsten or hardhat.
  const chain = parseInt(await hre.getChainId());
  return (chain !== 31337) && (chain !== 42);
};
fn.tags = ['Pyre'];

export default fn;
