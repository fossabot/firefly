<script lang="typescript">
    import { Text } from 'shared/components'
    import { getInitials as _getInitials } from 'shared/lib/helpers'

    export let classes = undefined
    export let locale

    export let name = ''
    export let id = ''
    export let isDeveloper = false
    export let onClick = () => ''
    export let bgColor

    let slots = $$props.$$slots

    function getInitials() {
        const initials = _getInitials(name)
        if (initials.length === 1) {
            return initials
        } else {
            const letters = initials.split('')
            return letters[0] + letters[letters.length - 1]
        }
    }
</script>

<div class="flex items-center justify-center w-24">
    <div class="flex flex-col justify-between items-center">
        <div
            on:click={() => onClick(id)}
            class="h-20 w-20 {bgColor ? `bg-${bgColor}-500` : ''} rounded-full font-bold text-center flex items-center justify-center {classes}">
            {#if slots}
                <slot />
            {:else}
                <Text type="h3" classes="text-white">{getInitials()}</Text>
            {/if}
        </div>
        <Text type="h5" classes="mt-5 text-center">{name}</Text>
        {#if isDeveloper}
            <div class="bg-gray-500 dark:bg-gray-700 dark:bg-opacity-20 rounded-full px-2 py-1 mt-4">
                <Text type="p" smaller classes="text-white">{locale('general.dev').toUpperCase()}</Text>
            </div>
        {/if}
    </div>
</div>
