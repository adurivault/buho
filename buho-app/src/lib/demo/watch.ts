import { FIT_MONITORING, type DecodedFit, type FitMesg } from '#lib/data/formats/fit/decode.ts';
import { fitSeconds } from '#lib/data/formats/fit/units.ts';
import { buildAgenda, type Activity, type Agenda } from './agenda';
import { atMinute, type LifeDay, type LifeOptions } from './life';
import { Random } from './random';

/**
 * The watch the demo person wears: the monitoring files a Garmin writes, one
 * per day, as the FIT decoder hands them over.
 *
 * Decoded files rather than packets or readings, so the sample takes the same
 * road as a real export: `stepPacketsFromFiles` differences the cumulative
 * counters and `healthReadingsFromFiles` resolves the offsets and drops the
 * sentinels, exactly as they do for a Garmin archive.
 *
 * Every minute is read off the shared agenda — asleep, sitting, strolling
 * round a museum, walking to work, cycling, running, standing in a bar, or off
 * the wrist — so the steps, the heart rate, the stress and the breathing tell
 * the same story as the map: the run is the loop round Montsouris, the night
 * out ends with a walk home at two and a restless night after it.
 */

export interface WatchOptions extends LifeOptions {
    /** How many months back the watch was bought. */
    months?: number;
    /** An agenda already built, so several samples can share one. */
    agenda?: Agenda;
}

const SLEEP = 0;
const REST = 1;
const WALK = 2;
const RUN = 3;
const BIKE = 4;
const SEATED = 5;
const STROLL = 6;
const BAR = 7;
const OFF = 8;

/** How often each reading is written, in minutes. */
const HEART_EVERY = 2;
const STRESS_EVERY = 3;
const BREATH_EVERY = 4;
/** The step counters are written at the end of each quarter-hour with movement in it. */
const COUNTER_EVERY = 15;

const STAY_STATE: Record<Activity, number> = {
    sleep: SLEEP,
    home: REST,
    work: REST,
    lunch: REST,
    friends: REST,
    bar: BAR,
    cinema: SEATED,
    museum: STROLL,
    market: STROLL,
    park: STROLL,
    sight: STROLL,
};

/** What each minute of the agenda was, from `first` on. */
function minuteStates(agenda: Agenda, first: number, last: number) {
    const length = last - first;
    const state = new Uint8Array(length).fill(REST);
    const effort = new Float32Array(length);
    const context = new Array<Activity | undefined>(length);

    for (const episode of agenda.episodes) {
        const from = Math.max(first, Math.round(episode.from));
        const to = Math.min(last, Math.round(episode.to));
        if (to <= from) continue;
        for (let m = from; m < to; m += 1) {
            const i = m - first;
            if (episode.type === 'stay') {
                state[i] = STAY_STATE[episode.activity];
                context[i] = episode.activity;
            } else if (episode.mode === 'metro') {
                // On foot to the platform and from it, standing in between.
                const t = (m - episode.from) / (episode.to - episode.from);
                state[i] = t < 0.18 || t > 0.85 ? WALK : SEATED;
            } else {
                state[i] =
                    episode.mode === 'walk'
                        ? WALK
                        : episode.mode === 'run'
                          ? RUN
                          : episode.mode === 'bike'
                            ? BIKE
                            : SEATED;
                effort[i] = episode.effort ?? 0;
            }
        }
    }
    return { state, effort, context };
}

/** Counters cumulative since local midnight, as the watch keeps them. */
interface Counters {
    cycles: number;
    activeTime: number;
    distance: number;
    calories: number;
}

const zero = (): Counters => ({ cycles: 0, activeTime: 0, distance: 0, calories: 0 });

function add(counters: Counters, steps: number, stride: number, perStep: number) {
    counters.cycles += steps / 2;
    counters.activeTime += Math.min(60, steps * 0.55);
    counters.distance += steps * stride;
    counters.calories += steps * perStep;
}

/** The monitoring files of every day the watch was worn, oldest first. */
export function generateWatchFiles(options: WatchOptions = {}): DecodedFit[] {
    const { months = 18, agenda = buildAgenda(options) } = options;
    const random = new Random((options.seed ?? 20261122) + 1);
    const { days } = agenda;

    const bought = Math.max(0, days.length - Math.round((months * 365.25) / 12));
    const first = bought * 1440;
    const last = days.length * 1440;
    const { state, effort, context } = minuteStates(agenda, first, last);

    // Off the wrist: the shower after waking and after a run, the charger
    // every few evenings, a night on the bedside table now and then.
    for (let i = 1; i < state.length; i += 1) {
        const woke = state[i - 1] === SLEEP && state[i] !== SLEEP;
        const ranOut = state[i - 1] === RUN && state[i] !== RUN;
        if (woke || ranOut) {
            const from = i + (woke ? random.int(8, 30) : random.int(2, 10));
            for (let k = from; k < Math.min(state.length, from + random.int(10, 20)); k += 1) {
                if (state[k] === REST) state[k] = OFF;
            }
        }
    }
    for (let d = 0; d < days.length - bought; d += 1) {
        if (random.bool(0.22)) {
            const from = d * 1440 + random.int(19 * 60, 22 * 60);
            for (let k = from; k < Math.min(state.length, from + random.int(40, 100)); k += 1) {
                if (state[k] === REST) state[k] = OFF;
            }
        }
        if (random.bool(0.05)) {
            const end = Math.min(state.length, (d + 1) * 1440 + 7 * 60);
            for (let k = d * 1440 + 22 * 60; k < end; k += 1) {
                if (state[k] === SLEEP) state[k] = OFF;
            }
        }
    }

    const files: DecodedFit[] = [];
    // Carried across days: the heart does not reset at midnight.
    let lag = 0;
    let load = 0.3;
    let afterBar = 0;

    for (let d = bought; d < days.length; d += 1) {
        const day = days[d];
        if (day.watchless) continue;
        files.push(dayFile(day, (d - bought) * 1440));
    }
    return files;

    function dayFile(day: LifeDay, offset: number): DecodedFit {
        const offsetMinutes = -day.start.getTimezoneOffset();
        const at = (minute: number) => atMinute(day, minute);

        // Resting heart rate: lower as the habit builds, up for a cold, a
        // little up in winter.
        const month = day.start.getMonth();
        const winter = month <= 1 || month === 11 ? 1.5 : 0;
        const resting = 62 - 8 * day.fitness + (day.kind === 'sick' ? 7 : 0) + winter;

        const monitoring: FitMesg[] = [];
        const stress: FitMesg[] = [];
        const breath: FitMesg[] = [];
        const walking = zero();
        const running = zero();
        const written = { walking: 0, running: 0 };
        let moved = 0;
        let ran = 0;

        for (let minute = 0; minute < 1440; minute += 1) {
            const i = offset + minute;
            const s = state[i];
            const hard = effort[i];
            const doing = context[i];

            let steps = 0;
            if (s === WALK) steps = random.normal(day.kind === 'holiday' ? 100 : 108, 9);
            else if (s === STROLL)
                steps = random.bool(0.5) ? random.range(35, 95) : random.range(0, 15);
            else if (s === BAR) steps = random.bool(0.25) ? random.range(10, 45) : 0;
            else if (s === BIKE) steps = random.range(0, 4);
            else if (s === REST) {
                // Pottering: up from the desk, round the kitchen.
                const chance = doing === 'work' ? 0.07 : doing === 'home' ? 0.04 : 0.02;
                if (random.bool(chance)) steps = random.range(15, 70);
            }

            if (s === RUN) {
                const cadence = random.normal(158 + 12 * hard, 3);
                add(running, cadence, 0.95 + 0.25 * hard + 0.1 * day.fitness, 0.07);
                ran += 1;
            } else if (steps > 0) {
                add(walking, steps, s === WALK ? 0.76 : 0.65, 0.04);
                moved += 1;
            }

            // The heart lags behind the body, climbing into an effort and
            // settling after it.
            const target =
                s === RUN
                    ? 65 + 30 * hard - 6 * day.fitness
                    : s === BIKE
                      ? 48
                      : s === WALK
                        ? 38
                        : s === STROLL
                          ? 22
                          : s === BAR
                            ? 24
                            : 0;
            lag += (target - lag) * (target > lag ? 0.3 : 0.1);

            const hour = minute / 60;
            const loadTarget =
                doing === 'work'
                    ? 0.55 + 0.15 * Math.sin(hour)
                    : day.kind === 'holiday'
                      ? 0.12
                      : day.kind === 'sick'
                        ? 0.4
                        : 0.25;
            load += (loadTarget - load) * 0.02 + random.normal(0, 0.025);
            load = Math.min(1, Math.max(0, load));
            if (s === BAR) afterBar = 1;
            else if (s !== SLEEP) afterBar *= 0.999;

            if ((minute + 1) % COUNTER_EVERY === 0) {
                const intensity = ran > 0 ? 6 : moved > 6 ? 3 : moved > 0 ? 1 : 0;
                for (const [type, counters] of [
                    ['walking', walking],
                    ['running', running],
                ] as const) {
                    const cycles = Math.round(counters.cycles);
                    if (cycles === written[type]) continue;
                    written[type] = cycles;
                    monitoring.push({
                        timestamp: at(minute + 1),
                        activityType: type,
                        cycles,
                        activeTime: Math.round(counters.activeTime),
                        distance: Math.round(counters.distance),
                        activeCalories: Math.round(counters.calories),
                        intensity,
                    });
                }
                moved = 0;
                ran = 0;
            }

            if (s === OFF) continue;

            if (minute % HEART_EVERY === 0) {
                // Asleep: the slow cycles of a night, restless after a night out.
                const asleep = -5 + 2.5 * Math.sin((minute / 90) * Math.PI * 2) + 7 * afterBar;
                const base = s === SLEEP ? asleep : s === SEATED ? 7 : 10 + 14 * load;
                monitoring.push({
                    timestamp: at(minute),
                    heartRate: Math.round(
                        random.normal(resting + base + lag, s === SLEEP ? 1.5 : 3.5)
                    ),
                });
            }

            if (minute % STRESS_EVERY === 0) {
                // Garmin cannot read stress while you move, and says so with a
                // negative value; the importer drops it.
                const value =
                    lag > 12
                        ? -2
                        : s === SLEEP
                          ? random.normal(10 + 10 * afterBar, 4)
                          : random.normal(12 + 60 * load, 9);
                stress.push({
                    stressLevelTime: at(minute),
                    stressLevelValue: Math.round(Math.min(99, value)),
                });
            }

            if (minute % BREATH_EVERY === 0) {
                const rate = s === SLEEP ? 12.8 : 14.5 + lag * 0.24;
                breath.push({
                    timestamp: at(minute),
                    respirationRate: Math.round(random.normal(rate, 0.7) * 10) / 10,
                });
            }
        }

        return {
            fileType: FIT_MONITORING,
            recordMesgs: [],
            sessionMesgs: [],
            activityMesgs: [],
            monitoringMesgs: monitoring,
            // Both clocks, so the importer places the day in its own time zone.
            monitoringInfoMesgs: [
                {
                    timestamp: day.start,
                    localTimestamp: fitSeconds(day.start) + offsetMinutes * 60,
                },
            ],
            stressLevelMesgs: stress,
            respirationRateMesgs: breath,
            monitoringHrDataMesgs: [],
        };
    }
}
