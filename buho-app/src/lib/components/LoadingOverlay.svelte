<script lang="ts">
    import { Loader2 } from "lucide-svelte";

    let { message } = $props<{ message: string }>();
</script>

<div
    class="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm transition-all"
    role="status"
    aria-live="polite"
>
    <div class="flex flex-col items-center gap-4 p-6 text-white rounded-lg">
        <Loader2 class="h-10 w-10 animate-spin text-[#2dd4a8]" />
        <p class="text-lg font-medium animate-pulse">{message}</p>
    </div>
</div>
