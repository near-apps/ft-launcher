
const BN = require('bn.js');
const nearAPI = require('near-api-js');
const testUtils = require('./test-utils');
const profileUtils = require('./profile-utils');
const getConfig = require('../src/config');

const { Contract, KeyPair, utils: { format: { parseNearAmount, formatNearAmount }} } = nearAPI;
const { 
	connection, initContract, contractAccount, contractName, contractMethods, 
	createOrInitAccount, getAccount,
} = testUtils;
const { 
	getCosts,
	setMark,
	getBurn,
	getStorage,
	getBurnAndStorage,
	startRecording,
} = profileUtils;
const { 
	networkId, GAS, GUESTS_ACCOUNT_SECRET
} = getConfig();


jasmine.DEFAULT_TIMEOUT_INTERVAL = 50000;

/// token stuff
const guestId = 'guests.' + contractAccount.accountId;

const getTokenContract = (account, token_account_id) => {
	return new Contract(account, token_account_id, contractMethods);
};

describe('deploy contract ' + contractName, () => {

	let alice, aliceId, storageMinimum, bobId, contractBob, contract;

	beforeAll(async () => {
	    const { contract: contractInstance } = await initContract();
		contract = contractInstance;

		const tokenId = contractAccount.accountId;

		alice = await getAccount();
		aliceId = alice.accountId;
		console.log('\n\n Alice accountId:', aliceId, '\n\n');

		/// find out how much needed to store for FTs
		storageMinimum = await contractAccount.viewFunction(contractName, 'storage_minimum_balance');
		console.log('\n\n storageMinimum:', storageMinimum, '\n\n');

		/// create guest account for bob
		bobId = 'g' + Date.now() + '.' + tokenId;
		console.log('\n\n', bobId, '\n\n');
		const keyPair = KeyPair.fromRandom('ed25519');
		const public_key = keyPair.publicKey.toString();
		const guestAccount = await createOrInitAccount(guestId, GUESTS_ACCOUNT_SECRET);

		startRecording();
		await setMark(guestId);
		await guestAccount.addKey(public_key, tokenId, contractMethods.changeMethods, parseNearAmount('0.1'));
		await getBurn(guestId);

		try {
			await setMark(contractName);
			await contract.add_guest({ account_id: bobId, public_key }, GAS);
			await getBurnAndStorage(contractName);
		} catch(e) {
			console.warn(e);
		}

		connection.signer.keyStore.setKey(networkId, guestId, keyPair);
		contractBob = getTokenContract(guestAccount, tokenId);
		const guest = await contract.get_guest({ public_key });
		console.log(guest);
	});

	test('alice gets 100 fts', async () => {
		await alice.functionCall(contractName, 'storage_deposit', {}, GAS, storageMinimum);
		let amount = parseNearAmount('100');
		await contractAccount.functionCall(contractName, 'ft_transfer', {
			receiver_id: aliceId,
			amount
		}, GAS, 1);
		/// check balance
		const balance = await contractAccount.viewFunction(contractName, 'ft_balance_of', { account_id: aliceId });
		expect(balance).toEqual(amount);
	});

	test('measure 1 alice ft_transfer', async () => {
		const amount = parseNearAmount('1');
		for (let i = 0; i < 1; i++) {
			await setMark(aliceId);
			await alice.functionCall(contractName, 'ft_transfer', { 
				receiver_id: bobId,
				amount
			 }, GAS, 1);
			await getBurn(aliceId, 'aliceTxs');
		}
		console.log('\n\n 1 alice ft_transfer:', formatNearAmount(getCosts('aliceTxs'), 12), '\n\n');
	});

	test('measure 1 owner transfers', async () => {
		const amount = parseNearAmount('1');
		for (let i = 0; i < 1; i++) {
			await setMark(contractName);
			await contract.ft_transfer({ 
				receiver_id: bobId,
				amount
			 }, GAS, 1);
			await getBurn(contractName, 'ownertxs');
		}
		console.log('\n\n 1 owner transfers:', formatNearAmount(getCosts('ownertxs'), 12), '\n\n');
	});

	test('claim drop', async () => {
		await setMark(guestId);
		await contractBob.claim_drop({});
		await getBurn(guestId);

		console.log('\n\n total cost of guest claiming drop:', formatNearAmount(getCosts(), 12), '\n\n');
	});

	test('bob upgrades self from guest to real account', async () => {
		const keyPair = KeyPair.fromRandom('ed25519');
		const keyPair2 = KeyPair.fromRandom('ed25519');
		const public_key = keyPair.publicKey.toString();
		const public_key2 = keyPair2.publicKey.toString();

		/// gas burnt on guest contract
		/// storage released (neg) on main contract
		await setMark(guestId);
		await setMark(contractName);
		const result = await contractBob.upgrade_guest({
			public_key,
			access_key: public_key2,
			method_names: '',
		}, GAS);
		console.log('RESULT', result);
		await getBurn(guestId);
		await getStorage(contractName);
		
		/// update account and contract for bob (bob now pays gas)
		connection.signer.keyStore.setKey(networkId, bobId, keyPair);
		const balance = await testUtils.getAccountBalance(bobId);
		/// creating account only moves 0.5 NEAR and the rest is still wNEAR
		expect(balance.total).toEqual(parseNearAmount('0.5'));
		
		console.log('\n\n total cost of guest claiming drop and then upgrading:', formatNearAmount(getCosts(), 12), '\n\n');
	});
});