import { activeProfile, updateProfile } from 'shared/lib/profile'
import type { Input, MigrationBundle, MigrationData } from 'shared/lib/typings/migration'
import Validator from 'shared/lib/validator'
import { api } from 'shared/lib/wallet'
import { derived, get, writable, Writable } from 'svelte/store'
import { convertToFiat, currencies, CurrencyTypes, exchangeRates } from 'shared/lib/currency'
import { formatUnit } from 'shared/lib/units'

export const LOG_FILE_NAME = 'migration'

export const MIGRATION_NODE = 'https://nodes-migration-legacy.iota.cafe:443'

export const PERMANODE = 'https://chronicle.iota.org/api'

export const ADDRESS_SECURITY_LEVEL = 2

/** Minimum migration balance */
export const MINIMUM_MIGRATION_BALANCE = 1000000

/** Bundle mining timeout for each bundle */
export const MINING_TIMEOUT_SECONDS = 60 * 10 

export const MINIMUM_WEIGHT_MAGNITUDE = 14;

const MAX_INPUTS_PER_BUNDLE = 30

interface Bundle {
    index: number;
    shouldMine: boolean;
    bundleHash?: string;
    crackability?: number;
    migrated: boolean;
    selected: boolean;
    inputs: Input[];
}

interface MigrationState {
    didComplete: Writable<boolean>;
    data: Writable<MigrationData>,
    seed: Writable<string>
    bundles: Writable<Bundle[]>
}

/*
 * Migration state
 */
export const migration = writable<MigrationState>({
    didComplete: writable<boolean>(false),
    data: writable<MigrationData>({
        lastCheckedAddressIndex: 0,
        balance: 0,
        inputs: []
    }),
    seed: writable<string>(null),
    bundles: writable<Bundle[]>([])
})

/*
 * Chrysalis status
 */
export const chrysalisLive = writable<Boolean>(false)
/**
 * Gets migration data and sets it to state
 * 
 * @method getMigrationData
 * 
 * @param {string} migrationSeed 
 * @param {number} initialAddressIndex 
 * 
 * @returns {Promise<void} 
 */
export const getMigrationData = (migrationSeed: string, initialAddressIndex = 0): Promise<void> => {
    const { seed, data } = get(migration)

    // data.set({
    //     balance: 0,
    //     inputs: [{
    //         address: 'A'.repeat(81),
    //         index: 0,
    //         balance: 11111110,
    //         spent: true,
    //         securityLevel: 2,
    //         spentBundleHashes: ['9'.repeat(81)]
    //     }, {
    //         address: 'B'.repeat(81),
    //         index: 1,
    //         balance: 10,
    //         spent: false,
    //         securityLevel: 2,
    //         spentBundleHashes: []
    //     }, {
    //         address: 'C'.repeat(81),
    //         index: 2,
    //         balance: 110,
    //         spent: true,
    //         securityLevel: 2,
    //         spentBundleHashes: ['9'.repeat(81)]

    //     }, {
    //         address: 'D'.repeat(81),
    //         index: 3,
    //         balance: 12210,
    //         spent: false,
    //         securityLevel: 2,
    //         spentBundleHashes: []
    //     }, {
    //         address: 'E'.repeat(81),
    //         index: 4,
    //         balance: 12210,
    //         spent: false,
    //         securityLevel: 2,
    //         spentBundleHashes: []
    //     }],
    //     lastCheckedAddressIndex: 30
    // })

    // prepareBundles()
    return new Promise((resolve, reject) => {
        api.getMigrationData(
            migrationSeed,
            [MIGRATION_NODE],
            ADDRESS_SECURITY_LEVEL,
            initialAddressIndex,
            undefined, {
            onSuccess(response) {
                const { seed, data } = get(migration)

                if (initialAddressIndex === 0) {
                    seed.set(migrationSeed)
                    data.set(response.payload)
                } else {
                    data.update((_existingData) => {
                        return Object.assign({}, _existingData, {
                            balance: _existingData.balance + response.payload.balance,
                            inputs: [..._existingData.inputs, ...response.payload.inputs],
                            lastCheckedAddressIndex: response.payload.lastCheckedAddressIndex
                        })
                    })
                }

                prepareBundles()

                resolve()
            },
            onError(error) {
                reject(error)
            },
        })
    })
};

/**
 * Creates migration bundle
 * 
 * @method createMigrationBundle
 * 
 * @param {number[]} inputIndexes 
 * @param {boolean} mine
 * 
 * @returns {Promise}
 */
export const createMigrationBundle = (inputAddressIndexes: number[], mine: boolean): Promise<any> => {
    const { seed } = get(migration)

    return new Promise((resolve, reject) => {
        api.createMigrationBundle(get(seed), inputAddressIndexes, mine, MINING_TIMEOUT_SECONDS, LOG_FILE_NAME, {
            onSuccess(response) {
                assignBundleHash(inputAddressIndexes, response.payload)
                resolve(response)
            },
            onError(error) {
                reject(error)
            },
        })
    })
};

export const sendMigrationBundle = (bundleHash: string, mwm = MINIMUM_WEIGHT_MAGNITUDE): Promise<void> => {
    return new Promise((resolve, reject) => {
        api.sendMigrationBundle([MIGRATION_NODE], bundleHash, mwm, {
            onSuccess(response) {
                const { bundles } = get(migration);

                // Update bundle and mark it as migrated
                bundles.update((_bundles) => {
                    return _bundles.map((bundle) => {
                        if (bundle.bundleHash === bundleHash) {
                            return Object.assign({}, bundle, { migrated: true })
                        }

                        return bundle
                    })
                })

                // Persist these bundles in local storage
                const _activeProfile = get(activeProfile)

                const migratedTransaction = {
                    address: response.payload.address,
                    balance: response.payload.value,
                    timestamp: new Date().toISOString(),
                    // Account index. Since we migrate funds to account at 0th index
                    index: 0
                }

                updateProfile(
                    'migratedTransactions',
                    _activeProfile.migratedTransactions ? [..._activeProfile.migratedTransactions, migratedTransaction] : [migratedTransaction]
                )
                resolve()
            },
            onError(error) {
                reject(error)
            },
        })
    })
}

/**
 * 
 * @param inputAddressIndexes 
 * @param migrationBundle 
 */
export const assignBundleHash = (inputAddressIndexes: number[], migrationBundle: MigrationBundle): void => {
    const { bundles } = get(migration);

    bundles.update((_bundles) => {
        return _bundles.map((bundle) => {
            const indexes = bundle.inputs.map((input) => input.index);
            if (indexes.length && indexes.every((index) => inputAddressIndexes.includes(index))) {
                return Object.assign({}, bundle, {
                    bundleHash: migrationBundle.bundleHash,
                    crackability: parseInt(migrationBundle.crackability.toString())
                })
            }

            return bundle
        })
    })
};

/**
 * Prepares inputs (as bundles) for unspent addresses.
 * Steps:
 *   - Categorises inputs in two groups 1) inputs with balance >= MINIMUM_MIGRATION_BALANCE 2) inputs with balance < MINIMUM_MIGRATION_BALANCE
 *   - Creates chunks of category 1 input addresses such that length of each chunk should not exceed MAX_INPUTS_PER_BUNDLE
 *   - For category 2: 
 *         - Sort the inputs in descending order based on balance;
 *         - Pick first N inputs (where N = MAX_INPUTS_PER_BUNDLE) and see if their accumulative balance >= MINIMUM_MIGRATION_BALANCE
 *         - If yes, then repeat the process for next N inputs. Otherwise, iterate on the remaining inputs and add it to a chunk that has space for more inputs
 *         - If there's no chunk with space left, then ignore these funds. NOTE THAT THESE FUNDS WILL ESSENTIALLY BE LOST!
 * 
 * NOTE: If the total sum of provided inputs are less than MINIMUM_MIGRATION_BALANCE, then this method will just return and empty array as those funds can't be migrated.
 * 
 * This method gives precedence to max inputs over funds. It ensures, a maximum a bundle could have is 30 inputs and their accumulative balance >= MINIMUM_MIGRATION_BALANCE
 * 
 * @method selectInputsForUnspentAddresses
 * 
 * @params {Input[]} inputs
 * 
 * @returns {Input[][]}
 */
const selectInputsForUnspentAddresses = (inputs: Input[]): Input[][] => {
    const totalInputsBalance: number = inputs.reduce((acc, input) => acc + input.balance, 0);

    // If the total sum of unspent addresses is less than MINIMUM MIGRATION BALANCE, just return an empty array as these funds cannot be migrated
    if (totalInputsBalance < MINIMUM_MIGRATION_BALANCE) {
        return [];
    }

    const { inputsWithEnoughBalance, inputsWithLowBalance } = inputs.reduce((acc, input) => {
        if (input.balance >= MINIMUM_MIGRATION_BALANCE) {
            acc.inputsWithEnoughBalance.push(input);
        } else {
            acc.inputsWithLowBalance.push(input);
        }

        return acc;
    }, { inputsWithEnoughBalance: [], inputsWithLowBalance: [] })

    let chunks = inputsWithEnoughBalance.reduce((acc, input, index) => {
        const chunkIndex = Math.floor(index / MAX_INPUTS_PER_BUNDLE)

        if (!acc[chunkIndex]) {
            acc[chunkIndex] = [] // start a new chunk
        }

        acc[chunkIndex].push(input)

        return acc
    }, [])

    const fill = (_inputs) => {
        _inputs.every((input) => {
            const chunkIndexWithSpaceForInput = chunks.findIndex((chunk) => chunk.length < MAX_INPUTS_PER_BUNDLE);

            if (chunkIndexWithSpaceForInput > -1) {
                chunks = chunks.map((chunk, idx) => {
                    if (idx === chunkIndexWithSpaceForInput) {
                        return [...chunk, input]
                    }

                    return chunk
                })

                return true;
            }

            // If there is no space, then exit
            return false;
        })
    }

    const totalBalanceOnInputsWithLowBalance: number = inputsWithLowBalance.reduce((acc, input) => acc + input.balance, 0)

    // If all the remaining input addresses have accumulative balance less than the minimum migration balance,
    // Then sort the inputs in descending order and try to pair the
    if (totalBalanceOnInputsWithLowBalance < MINIMUM_MIGRATION_BALANCE) {
        const sorted = inputsWithLowBalance.slice().sort((a, b) => b.balance - a.balance)

        fill(sorted)
    } else {
        let startIndex = 0

        const sorted = inputsWithLowBalance.slice().sort((a, b) => b.balance - a.balance)
        const max = Math.ceil(sorted.length / MAX_INPUTS_PER_BUNDLE);

        while (startIndex < max) {
            const inputsSubset = sorted.slice(startIndex * MAX_INPUTS_PER_BUNDLE, (startIndex + 1) * MAX_INPUTS_PER_BUNDLE)
            const balanceOnInputsSubset = inputsSubset.reduce((acc, input) => acc + input.balance, 0);

            if (balanceOnInputsSubset >= MINIMUM_MIGRATION_BALANCE) {
                chunks = [...chunks, inputsSubset]
            } else {
                fill(inputsSubset)
            }

            startIndex++;
        }
    }

    return chunks;
};

export const prepareBundles = () => {
    const { data, bundles } = get(migration)

    const { inputs } = get(data)

    // Categorise spent vs unspent inputs
    const { spent, unspent } = inputs.reduce((acc, input) => {
        if (input.spent) {
            acc.spent.push(input)
        } else {
            acc.unspent.push(input)
        }

        return acc;
    }, { spent: [], unspent: [] })

    const unspentInputChunks = selectInputsForUnspentAddresses(unspent)

    bundles.set([
        ...spent.map((input) => ({ migrated: false, selected: input.balance >= MINIMUM_MIGRATION_BALANCE, shouldMine: true, inputs: [input] })),
        ...unspentInputChunks.map((inputs) => ({ migrated: false, selected: true, shouldMine: false, inputs }))
    ].map((_, index) => ({ ..._, index })))
};

export const getInputIndexesForBundle = (bundle: Bundle): number[] => {
    const { inputs } = bundle;

    return inputs.map((input) => input.index);
}

export const spentAddressesFromBundles = derived(get(migration).bundles, (_bundles) => _bundles
    .filter((bundle) => bundle.shouldMine === true)
    // TODO: Perhaps use a different way to gather inputs
    .map((bundle) => Object.assign({}, bundle.inputs[0], {
        bundleHash: bundle.bundleHash,
        crackability: bundle.crackability
    }))
)

export const hasSingleBundle = derived(get(migration).bundles, (_bundles) => _bundles.length === 1)

export const hasBundlesWithSpentAddresses = derived(get(migration).bundles, (_bundles) => _bundles.length && _bundles.some((bundle) => bundle.shouldMine === true))

export const toggleInputSelection = (address: string): void => {
    const { bundles } = get(migration)

    bundles.update((_bundles) => _bundles.map((bundle) => {
        if (bundle.inputs.some((input) => input.address === address)) {
            return Object.assign({}, bundle, { selected: !bundle.selected })
        }

        return bundle
    }))
}

export const selectedBundlesWithSpentAddresses = derived(get(migration).bundles, (_bundles) => _bundles.filter((bundle) =>
    bundle.selected === true &&
    bundle.shouldMine === true
))

export const unmigratedBundles = derived(get(migration).bundles, (_bundles) => _bundles.filter((bundle) =>
    bundle.migrated === false
))

export const hasMigratedAllBundles = derived(get(migration).bundles, (_bundles) => _bundles.length && _bundles.every((bundle) =>
    bundle.migrated === true
))

/**
 * List of chrysalis node endpoints to detect when is live
 */
export const CHRYSALIS_NODE_ENDPOINTS = ['https://api.hornet-0.testnet.chrysalis2.com/api/v1/info']
/**
* Default timeout for a request made to an endpoint
*/
const DEFAULT_CHRYSALIS_NODE_ENDPOINT_TIMEOUT = 5000
/**
* Mainnet ID used in a chrysalis node
*/
const MAINNET_ID = 'mainnet'
/**
 * Default interval for polling the market data
 */
const DEFAULT_CHRYSALIS_NODE_POLL_INTERVAL = 300000 // 5 minutes
type ChrysalisNode = {
    data: ChrysalisNodeData
}
type ChrysalisNodeData = {
    networkId: string
}
export type ChrysalisNodeDataValidationResponse = {
    type: 'ChrysalisNode'
    payload: ChrysalisNode
}
let chrysalisStatusIntervalID = null
/**
 * Poll the Chrysalis mainnet status at an interval
 */
export async function pollChrysalisStatus(): Promise<void> {
    await checkChrysalisStatus()
    chrysalisStatusIntervalID = setInterval(async () => checkChrysalisStatus(), DEFAULT_CHRYSALIS_NODE_POLL_INTERVAL)
}
/**
 * Stops Chrysalis mainnet poll
 */
function stopPoll(): void {
    if (chrysalisStatusIntervalID) {
        clearInterval(chrysalisStatusIntervalID)
    }
}
/**
 * Fetches Chrysalis mainnet status
 *
 * @method fetchMarketData
 *
 * @returns {Promise<void>}
 */
export async function checkChrysalisStatus(): Promise<void> {
    const requestOptions: RequestInit = {
        headers: {
            Accept: 'application/json',
        },
    }
    for (let index = 0; index < CHRYSALIS_NODE_ENDPOINTS.length; index++) {
        const endpoint = CHRYSALIS_NODE_ENDPOINTS[index]
        try {
            const abortController = new AbortController()
            const timerId = setTimeout(
                () => {
                    if (abortController) {
                        abortController.abort();
                    }
                },
                DEFAULT_CHRYSALIS_NODE_ENDPOINT_TIMEOUT);

            requestOptions.signal = abortController.signal;

            const response = await fetch(endpoint, requestOptions);

            clearTimeout(timerId)

            const jsonResponse: ChrysalisNode = await response.json()

            const { isValid, payload } = new Validator().performValidation({
                type: 'ChrysalisNode',
                payload: jsonResponse,
            })
            if (isValid) {
                const nodeData: ChrysalisNodeData = jsonResponse?.data
                if (nodeData?.networkId === MAINNET_ID) {
                    chrysalisLive.set(true)
                    stopPoll()
                    break
                }
            } else {
                throw new Error(payload.error)
            }
            break
        } catch (err) {
            console.error(err.name === "AbortError" ? new Error(`Could not fetch from ${endpoint}.`) : err)
        }
    }
}
