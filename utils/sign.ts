const {ethers} = require('ethers');
const signer = process.env.SIGNER;

async function signMessage( types: string[], data: any[]) {
    const wallet = new ethers.Wallet(`0x${signer}`);
   
    let message = ethers.utils.solidityPack(types, data);
    message = ethers.utils.solidityKeccak256(["bytes"], [message]);
    const signature = await wallet.signMessage(ethers.utils.arrayify(message));

    return signature;
}

export default signMessage;