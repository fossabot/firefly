<script lang="typescript">
    import { Text } from 'shared/components'

    export let onClick = () => ''
    export let name = ''
    export let balance = ''
    export let balanceEquiv = ''
    export let color = 'turquoise'
    export let size = 'm' // m, l
    export let hidden = false
    export let disabled = false
</script>

<style type="text/scss">
    button {
        height: auto;
        min-height: 100px;
        max-height: 100%;
        &.size-l {
            min-height: 140px;
        }
        &:disabled {
            @apply pointer-events-none;
            @apply opacity-50;
        }
    }
</style>

<button
    on:click={onClick}
    class="size-{size} group rounded-xl bg-gray-100 dark:bg-gray-900 hover:bg-{color}-500 font-400 flex flex-col justify-between text-left p-{size === 's' ? '3' : '6'} {hidden ? 'opacity-50' : ''}"
    {disabled}>
    <div class="w-full">
        <Text
            bold
            smaller={size === 's'}
            overrideColor
            classes="mb-2 text-gray-800 dark:text-white group-hover:text-white overflow-hidden overflow-ellipsis">
            {name}
        </Text>
    </div>
    <div
        class="flex {size === 'l' ? 'flex-row space-x-4' : 'flex-col space-y-1'} justify-between w-full flex-{size === 'l' ? 'nowrap' : 'wrap'}">
        <Text smaller overrideColor classes="block text-gray-800 dark:text-white group-hover:text-white">{balance}</Text>
        <Text smaller overrideColor classes="block text-blue-500 dark:text-gray-600 group-hover:text-white">{balanceEquiv}</Text>
    </div>
</button>
