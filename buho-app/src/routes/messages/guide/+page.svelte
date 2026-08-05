<script lang="ts">
    import { dataStore } from "$lib/stores/dataStore.svelte";
    import {
        getMessageMacroStats,
        getMonthlyMessagesByContact,
        getHourWeekdayGrid,
        getDailyMessageCounts,
        getContactBalance,
        getContactReplyTimes,
        getMonthlyVolumeForTopContacts,
        getReactionBreakdown,
        getContactReactionRates,
        type MessageMacroStats,
        type MonthlyContactCount,
        type HourWeekdayCell,
        type DailyMessageCount,
        type ContactBalance,
        type ContactReplyTimes,
        type ReactionCount,
        type ContactReactionRate,
    } from "$lib/data/queries/messageQueries";
    import {
        hourWeekdayHeatmapPlot,
        messageCalendarPlot,
        conversationBalancePlot,
        replyTimeQuadrantPlot,
        contactRidgelinePlot,
        reactionBreakdownPlot,
        formatDuration,
    } from "$lib/visualizations/plots/messagePlots";
    import PlotChart from "$lib/components/PlotChart.svelte";
    import BarChartRace, {
        type RaceRow,
    } from "$lib/components/visualizations/BarChartRace.svelte";
    import GuideToExploreHandoffSection from "$lib/components/sections/GuideToExploreHandoffSection.svelte";
    import GuidePage from "$lib/components/guide/GuidePage.svelte";
    import GuideSection from "$lib/components/guide/GuideSection.svelte";
    import { longestDailyStreak } from "$lib/utils/streak";
    import { NETWORK_LABELS } from "$lib/types/messages";

    /** Services present in the store, so the guide can name what it's mixing. */
    const networks = $derived(dataStore.messagesSummary);

    const dbReady = $derived(
        dataStore.source === "messages" && !dataStore.isLoading,
    );

    let stats = $state<MessageMacroStats | null>(null);
    let contactRace = $state<RaceRow[]>([]);
    let grid = $state<HourWeekdayCell[]>([]);
    let days = $state<DailyMessageCount[]>([]);
    let balance = $state<ContactBalance[]>([]);
    let replyTimes = $state<ContactReplyTimes[]>([]);
    let ridgeRows = $state<MonthlyContactCount[]>([]);
    let reactions = $state<ReactionCount[]>([]);
    let reactionRates = $state<ContactReactionRate[]>([]);

    /** Sent / received split of the rhythm heatmap. */
    let rhythmSide = $state<"both" | "sent" | "received">("both");

    // Everything reads the same table, which the import has already finished
    // building — one load, no staged enrichment (unlike the Timeline source).
    let loaded = false;
    $effect(() => {
        if (!dbReady || loaded) return;
        loaded = true;
        (async () => {
            const [
                macro,
                monthly,
                hourGrid,
                daily,
                contactBalance,
                replies,
                ridge,
                reactionCounts,
                rates,
            ] = await Promise.all([
                getMessageMacroStats(),
                getMonthlyMessagesByContact(),
                getHourWeekdayGrid(),
                getDailyMessageCounts(),
                getContactBalance(),
                getContactReplyTimes(),
                getMonthlyVolumeForTopContacts(15),
                getReactionBreakdown(),
                getContactReactionRates(),
            ]);
            stats = macro;
            contactRace = monthly.map((r) => ({
                month: r.month,
                name: r.name,
                value: r.messages,
            }));
            grid = hourGrid;
            days = daily;
            balance = contactBalance;
            replyTimes = replies;
            ridgeRows = ridge;
            reactions = reactionCounts;
            reactionRates = rates;
        })();
    });

    const streak = $derived(longestDailyStreak(days.map((d) => d.date)));

    /** Share of a total, as a rounded percentage. */
    const share = (part: number, total: number) =>
        total > 0 ? Math.round((part / total) * 100) : 0;

    // Rounded: the race interpolates between months, so a raw value lands
    // mid-transition as "1 234.56" — a fractional message count means nothing.
    const formatCount = (v: number) => Math.round(v).toLocaleString();

    /** How few people carry half the volume — the concentration of the export. */
    const halfOfEverything = $derived.by(() => {
        const total = balance.reduce((s, b) => s + b.messages, 0);
        let running = 0;
        for (const [i, b] of balance.entries()) {
            running += b.messages;
            if (running * 2 >= total) return i + 1;
        }
        return balance.length;
    });

    const topReactor = $derived(reactionRates[0] ?? null);

    const myDoubleTexts = $derived(
        balance.reduce((s, b) => s + b.myDoubleTexts, 0),
    );

    function formatDay(date: string): string {
        const d = new Date(`${date}T00:00:00`);
        return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString();
    }

</script>

<GuidePage accent="var(--accent-messages)">
    {#if !dbReady}
        <p class="empty">Import your messages export to see the guide.</p>
    {:else if !stats}
        <p class="empty" role="status">Reading your conversations…</p>
    {:else}
        <GuideSection
            id="messages-macro"
            title="Your conversations in numbers"
            hint="Everything in this export at a glance. A conversation is one burst of back-and-forth: once six hours of silence pass, the next message starts a new one."
        >
            <div class="stats">
                <div class="stat">
                    <div class="value">
                        {stats.totalMessages.toLocaleString()}
                    </div>
                    <div class="label">Messages</div>
                </div>
                <div class="stat">
                    <div class="value">{stats.contacts.toLocaleString()}</div>
                    <div class="label">People</div>
                </div>
                <div class="stat">
                    <div class="value">{stats.words.toLocaleString()}</div>
                    <div class="label">Words written</div>
                </div>
                <div class="stat">
                    <div class="value">
                        {stats.conversations.toLocaleString()}
                    </div>
                    <div class="label">Conversations</div>
                </div>
                <div class="stat">
                    <div class="value">
                        {share(stats.sentMessages, stats.totalMessages)}%
                    </div>
                    <div class="label">Written by you</div>
                </div>
                <div class="stat">
                    <div class="value">
                        {stats.myMedianReplySeconds === null
                            ? "—"
                            : formatDuration(stats.myMedianReplySeconds)}
                    </div>
                    <div class="label">Your median reply</div>
                </div>
                <div class="stat">
                    <div class="value">{stats.voiceNotes.toLocaleString()}</div>
                    <div class="label">Voice notes</div>
                </div>
                <div class="stat">
                    <div class="value">
                        {stats.reactionsReceived.toLocaleString()}
                    </div>
                    <div class="label">Reactions received</div>
                </div>
            </div>
            <p class="coverage">
                From <b>{formatDay(stats.firstDay ?? "")}</b> to
                <b>{formatDay(stats.lastDay ?? "")}</b>, across
                <b>{stats.activeDays.toLocaleString()}</b> days with at least one
                message. Half of everything you exchanged went to
                <b>{halfOfEverything}</b>
                {halfOfEverything === 1 ? "person" : "people"}.
            </p>
            {#if networks.length > 1}
                <p class="coverage">
                    Across {networks.length} services —
                    {#each networks as summary, i}{i > 0 ? ", " : ""}<b
                            >{NETWORK_LABELS[summary.network]}</b
                        >
                        ({summary.messages.toLocaleString()}){/each}. Someone you
                    talk to on two of them counts as two contacts here: nothing
                    in the exports links one identity to the other.
                </p>
            {/if}
        </GuideSection>

        <BarChartRace
            trackId="messages-contact-race"
            title="Who you talk to, month by month"
            hint="A month-by-month race between the people you message, counting
            messages as they add up. The bars reorder as friendships take over and
            others go quiet."
            rows={contactRace}
            formatValue={formatCount}
            ariaLabel="Bar chart race of cumulative messages per contact"
            loadingLabel="Loading contact race…"
        />

        <GuideSection
            id="messages-rhythm"
            title="The hours you talk"
            hint="Every message placed on the week it belongs to: day across the rows, hour across the columns. Switch sides to see whether you and the people you talk to keep the same hours."
        >
            <div class="toggle" role="group" aria-label="Message direction">
                {#each [{ id: "both", label: "Both" }, { id: "sent", label: "Sent" }, { id: "received", label: "Received" }] as const as option}
                    <button
                        type="button"
                        class="toggle-btn"
                        class:selected={rhythmSide === option.id}
                        aria-pressed={rhythmSide === option.id}
                        onclick={() => (rhythmSide = option.id)}
                    >
                        {option.label}
                    </button>
                {/each}
            </div>
            {#if grid.length}
                <PlotChart
                    plotFn={(data) =>
                        hourWeekdayHeatmapPlot(data, { direction: rhythmSide })}
                    data={grid}
                />
            {:else}
                <p class="empty">No messages to place on the week.</p>
            {/if}
        </GuideSection>

        <GuideSection
            id="messages-calendar"
            title="Your year in messages"
            hint="One square per day, the darker the more you wrote and received. Quiet weeks, holidays and the days a conversation ran all evening each leave their own mark."
        >
            {#if days.length}
                <p class="coverage">
                    Your longest run of consecutive days with messages lasted
                    <b>{streak.length}</b>
                    {streak.length === 1 ? "day" : "days"}{#if streak.start}, from
                        <b>{formatDay(streak.start)}</b>{/if}.
                </p>
                <div class="bleed">
                    <PlotChart plotFn={messageCalendarPlot} data={days} />
                </div>
            {:else}
                <p class="empty">No daily activity to draw.</p>
            {/if}
        </GuideSection>

        <GuideSection
            id="messages-balance"
            title="Who chases whom"
            hint="Each thread split by who wrote it. Bars leaning left are conversations you carry; bars leaning right are the ones carried for you. The number on the right is the size of the thread."
        >
            {#if balance.length}
                <p class="coverage">
                    You wrote <b
                        >{share(stats.sentMessages, stats.totalMessages)}%</b
                    >
                    of everything in this export, and followed up on your own message
                    <b>{myDoubleTexts.toLocaleString()}</b> times without waiting
                    for an answer.
                </p>
                <PlotChart plotFn={conversationBalancePlot} data={balance} />
            {:else}
                <p class="empty">No conversations to compare.</p>
            {/if}
        </GuideSection>

        <GuideSection
            id="messages-reply-times"
            title="Who answers faster"
            hint="Your median reply time to someone against theirs to you, both on a logarithmic scale. Below the dotted line they answer you faster than you answer them; above it you're the quick one. Only replies inside a live conversation count — a message sent after a night's sleep isn't a reply time."
        >
            {#if replyTimes.length}
                <p class="coverage">
                    You answer in <b
                        >{stats.myMedianReplySeconds === null
                            ? "—"
                            : formatDuration(stats.myMedianReplySeconds)}</b
                    >
                    on median, they answer you in
                    <b
                        >{stats.theirMedianReplySeconds === null
                            ? "—"
                            : formatDuration(stats.theirMedianReplySeconds)}</b
                    >.
                </p>
                <PlotChart plotFn={replyTimeQuadrantPlot} data={replyTimes} />
            {:else}
                <p class="empty">
                    Not enough back-and-forth in this export to measure reply
                    times.
                </p>
            {/if}
        </GuideSection>

        <GuideSection
            id="messages-ridgeline"
            title="Friendships over time"
            hint="One ridge per person, stacked in the order they first appear in your messages. The swells are the months a friendship ran hot; the flat stretches are the months it didn't."
        >
            {#if ridgeRows.length}
                <div class="bleed">
                    <PlotChart plotFn={contactRidgelinePlot} data={ridgeRows} />
                </div>
            {:else}
                <p class="empty">No conversations to lay out over time.</p>
            {/if}
        </GuideSection>

        <GuideSection
            id="messages-reactions"
            title="How people react"
            hint="The emojis landing on your messages, against the ones you put on theirs. The two rarely match: people react to you in their own vocabulary."
        >
            {#if reactions.length}
                {#if topReactor}
                    <p class="coverage">
                        <b>{topReactor.contact}</b> reacts the most:
                        <b>{topReactor.ratePer100.toFixed(0)}</b> reactions per 100
                        messages you send them.
                    </p>
                {/if}
                <PlotChart plotFn={reactionBreakdownPlot} data={reactions} />
            {:else}
                <p class="empty">No reactions in this export.</p>
            {/if}
        </GuideSection>

        <GuideToExploreHandoffSection explorePath="/messages/explore/" />
    {/if}
</GuidePage>

<style>
    /* Sent / received switch above the rhythm heatmap — the only control this
       guide owns; everything else is laid out by GuidePage. */
    .toggle {
        display: inline-flex;
        gap: 0.25rem;
        margin-bottom: 1rem;
        padding: 0.2rem;
        border: 1px solid hsl(var(--border));
        border-radius: 999px;
        background: hsl(var(--secondary) / 0.4);
    }

    .toggle-btn {
        border: none;
        background: transparent;
        border-radius: 999px;
        padding: 0.25rem 0.85rem;
        font-size: 0.8rem;
        color: hsl(var(--muted-foreground));
        cursor: pointer;
        transition:
            color 0.15s,
            background-color 0.15s;
    }

    .toggle-btn:hover {
        color: hsl(var(--foreground));
    }

    .toggle-btn.selected {
        background: hsl(var(--background));
        color: hsl(var(--foreground));
        font-weight: 600;
    }
</style>
