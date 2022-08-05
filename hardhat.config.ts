import * as dotenv from "dotenv";

import { HardhatUserConfig, task } from "hardhat/config";
import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-waffle";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "hardhat-deploy";
import { utils } from 'ethers';

dotenv.config();

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

function node(networkName: string) {
  const fallback = 'http://localhost:8545';
  const uppercase = networkName.toUpperCase();
  const uri = process.env[`NODE_${uppercase}`] || fallback;
  return uri.replace('{{NETWORK}}', networkName);
}

function accounts(networkName: string) {
  const uppercase = networkName.toUpperCase();
  const accounts = process.env[`ACCOUNTS_${uppercase}`] || '';
  return accounts
    .split(',')
    .map((account) => account.trim())
    .filter(Boolean);
}

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more
interface CustomUserConfig extends HardhatUserConfig {
  namedAccounts: any
}

const config: CustomUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.5.16",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
            details: {
              yul: false
            }
          }
        }
      },
      {
        version: "0.6.12",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
            details: {
              yul: false
            }
          }
        }
      },
    ]
  },
  namedAccounts: {
    deployer: 0,
    fundOwner: 1,
    unlocker: 2,
    other: 3
  },
  defaultNetwork: "hardhat",

  networks: {
    hardhat: {
      hardfork: 'istanbul',
      accounts: {
        accountsBalance: utils.parseEther('10000000000000000').toString(),
        count: 10,
      },
      forking: {
        // blockNumber: 14592087,
        blockNumber: 16976786, // bsc
        // blockNumber: 831317, // astra
        // blockNumber: 29959371, // polygon
        url: node('mainnet'), // May 31, 2021
      },
      gas: 9500000,
      gasPrice: 1000000, // TODO: Consider removing this again.
      ...(process.env.COVERAGE && {
        allowUnlimitedContractSize: true,
      }),
    },
    mainnet: {
      hardfork: 'istanbul',
      url: node('mainnet'),
      accounts: accounts('mainnet')
    },
    testnet: {
      url: node('testnet'),
      accounts: accounts('testnet')
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  mocha: {
    timeout: 100000000
  },
};

export default config;
