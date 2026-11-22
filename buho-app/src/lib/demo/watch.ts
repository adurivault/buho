import { FIT_MONITORING, type DecodedFit, type FitMesg } from '#lib/data/formats/fit/decode.ts';
import { fitSeconds } from '#lib/data/formats/fit/units.ts';
import { atMinute, lifeDays, type LifeDay, type LifeOptions } from './life';
import { Random } from './random';

/**
 * The watch the demo person wears: the monitoring files a Garmin writes, one
 * per day, as the FIT decoder hands them over.
 *
 * Decoded files rather than packets or readings, so the sample takes the same
 * road as a real export: `stepPacketsFromFiles` differences the cumulative
 * counters and `healthReadingsFromFiles` resolves the offsets and drops the
 * sentinels, exactly as they do for a Garmin archive. A sample that skipped
 * them would be a sample of something the app never shows.
 *
 * The day is planned minute by minute — asleep, sitting, walking, running or
 * off the wrist — and every reading is drawn from that plan, so the steps, the
 * heart rate, the stress and the breathing all tell the same story: the run
 * shows in all four, the cold lifts the resting heart rate, the holiday walks
 * twice as far.
 */

export interface WatchOptions extends LifeOptions {
    /** How many months back the watch was bought. */
    months?: number;
}

type State = 'sleep' | 'rest' | 'walk' | 'run' | 'off';

/** How often each reading is written, in minutes. */
const HEART_EVERY = 5;
const STRESS_EVERY = 10;
const BREATH_EVERY = 10;
/** The step counters are written at the end of each quarter-hour with movement in it. */
const COUNTER_EVERY = 15;

const MINUTES = 24 * 60;

/** Fill `[from, to)` of the plan, clamped to the day. */
function fill(plan: State[], from: number, to: number, state: State) {
    for (let m = Math.max(0, Math.round(from)); m < Math.min(MINUTES, Math.round(to)); m += 1) {
        plan[m] = state;
    }
}

/** One day, minute by minute. */
function planDay(day: LifeDay, random: Random): State[] {
    const plan: State[] = new Array(MINUTES).fill('rest');
    const late = day.kind === 'weekend' || day.kind === 'holiday';

    const wake = late ? random.normal(8.6 * 60, 35) : random.normal(7 * 60, 12);
    const bed = random.normal((late ? 24.1 : 23.3) * 60, 25);
    fill(plan, 0, wake, 'sleep');
    fill(plan, bed, MINUTES, 'sleep');

    // The shower, every morning, and the watch on the charger every few days.
    fill(plan, wake + 10, wake + 30, 'off');
    if (random.bool(0.25)) {
        const charge = random.range(19, 21.5) * 60;
        fill(plan, charge, charge + random.range(45, 90), 'off');
    }

    const walk = (from: number, minutes: number) => fill(plan, from, from + minutes, 'walk');

    switch (day.kind) {
        case 'work':
            walk(random.normal(8.1 * 60, 6), random.range(16, 24));
            if (random.bool(0.6)) walk(random.normal(12.4 * 60, 10), random.range(10, 25));
            walk(random.normal(18.1 * 60, 15), random.range(16, 26));
            for (let i = random.int(0, 3); i > 0; i -= 1) walk(random.range(9.5, 17) * 60, 4);
            break;
        case 'weekend':
            for (let i = random.int(1, 3); i > 0; i -= 1) {
                walk(random.range(10, 19) * 60, random.range(15, 55));
            }
            break;
        case 'holiday':
            for (let i = random.int(3, 5); i > 0; i -= 1) {
                walk(random.range(9.5, 21) * 60, random.range(25, 75));
            }
            break;
        case 'sick':
            if (random.bool(0.6)) walk(random.range(11, 17) * 60, random.range(6, 14));
            break;
    }

    if (day.run) {
        // Before work on a weekday, a longer one late on a Sunday morning.
        const sunday = day.weekday === 0;
        const start = sunday ? random.normal(10 * 60, 20) : wake + random.range(5, 10);
        const minutes = sunday ? random.range(55, 80) : random.range(30, 45);
        fill(plan, start, start + minutes, 'run');
        if (!sunday) fill(plan, start + minutes, start + minutes + 20, 'off');
    }

    // Some nights the watch stays on the bedside table.
    if (random.bool(0.06)) fill(plan, bed, MINUTES, 'off');

    return plan;
}

/** One reading of the step counters, cumulative since local midnight. */
interface Counters {
    cycles: number;
    activeTime: number;
    distance: number;
    calories: number;
}

const zero = (): Counters => ({ cycles: 0, activeTime: 0, distance: 0, calories: 0 });

/** The monitoring file of one day. */
function dayFile(day: LifeDay, random: Random): DecodedFit {
    const plan = planDay(day, random);
    const offsetMinutes = -day.start.getTimezoneOffset();
    const at = (minute: number) => atMinute(day, minute);

    // Resting heart rate: lower as the habit builds, up for a cold, a little
    // up in winter.
    const month = day.start.getMonth();
    const winter = month <= 1 || month === 11 ? 1.5 : 0;
    const resting = 61 - 7 * day.fitness + (day.kind === 'sick' ? 7 : 0) + winter;

    const monitoring: FitMesg[] = [];
    const stress: FitMesg[] = [];
    const breath: FitMesg[] = [];

    const walking = zero();
    const running = zero();
    // What each counter read when it was last written: a quarter-hour with no
    // movement writes nothing, as on the watch.
    const written = { walking: 0, running: 0 };
    let walked = 0;
    let ran = 0;
    // How hard the heart is still working, so it climbs into a run and settles after.
    let effort = 0;
    let load = random.range(0.2, 0.5);

    for (let minute = 0; minute < MINUTES; minute += 1) {
        const state = plan[minute];

        if (state === 'walk') {
            const steps = random.normal(day.kind === 'holiday' ? 98 : 108, 8);
            walking.cycles += steps / 2;
            walking.activeTime += 60;
            walking.distance += steps * 0.74;
            walking.calories += steps * 0.04;
            walked += 1;
        } else if (state === 'run') {
            const steps = random.normal(164, 4);
            running.cycles += steps / 2;
            running.activeTime += 60;
            running.distance += steps * (1.02 + 0.12 * day.fitness);
            running.calories += steps * 0.065;
            ran += 1;
        } else if (state === 'rest' && random.bool(0.04)) {
            // Pottering: a few steps between the desk and the kitchen.
            const steps = random.int(8, 40);
            walking.cycles += steps / 2;
            walking.activeTime += Math.min(60, steps);
            walking.distance += steps * 0.7;
            walking.calories += steps * 0.035;
        }

        const target = state === 'run' ? 1 : state === 'walk' ? 0.35 : 0;
        effort += (target - effort) * (target > effort ? 0.35 : 0.12);

        // Stress follows the workday, eases in the evening, and sleeps.
        const hour = minute / 60;
        const working = day.kind === 'work' && hour >= 8.5 && hour < 18;
        const loadTarget = working ? 0.55 : day.kind === 'holiday' ? 0.15 : 0.25;
        load += (loadTarget - load) * 0.02 + random.normal(0, 0.03);
        load = Math.min(1, Math.max(0, load));

        const end = minute + 1;
        if (end % COUNTER_EVERY === 0) {
            const intensity = ran > 0 ? 6 : walked > 0 ? 3 : 0;
            for (const [type, counters] of [
                ['walking', walking],
                ['running', running],
            ] as const) {
                const cycles = Math.round(counters.cycles);
                if (cycles === written[type]) continue;
                written[type] = cycles;
                monitoring.push({
                    timestamp: at(end),
                    activityType: type,
                    cycles,
                    activeTime: counters.activeTime,
                    distance: Math.round(counters.distance),
                    activeCalories: Math.round(counters.calories),
                    intensity,
                });
            }
            walked = 0;
            ran = 0;
        }

        if (state === 'off') continue;

        if (minute % HEART_EVERY === 0) {
            const awake = state === 'sleep' ? -4 : 10 + 12 * load;
            const heartRate = resting + awake + effort * (85 + 10 * (1 - day.fitness));
            monitoring.push({
                timestamp: at(minute),
                heartRate: Math.round(random.normal(heartRate, 3)),
            });
        }

        if (minute % STRESS_EVERY === 0) {
            // Garmin cannot read stress while you move, and says so with a
            // negative value; the importer drops it.
            const value =
                effort > 0.2
                    ? -2
                    : state === 'sleep'
                      ? random.normal(12, 4)
                      : random.normal(15 + 55 * load, 8);
            stress.push({ stressLevelTime: at(minute), stressLevelValue: Math.round(value) });
        }

        if (minute % BREATH_EVERY === 0) {
            const rate = state === 'sleep' ? 12.5 : 14.5 + 18 * effort;
            breath.push({
                timestamp: at(minute),
                respirationRate: Math.round(random.normal(rate, 0.8) * 10) / 10,
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
            { timestamp: day.start, localTimestamp: fitSeconds(day.start) + offsetMinutes * 60 },
        ],
        stressLevelMesgs: stress,
        respirationRateMesgs: breath,
        monitoringHrDataMesgs: [],
    };
}

/** The monitoring files of every day the watch was worn, oldest first. */
export function generateWatchFiles(options: WatchOptions = {}): DecodedFit[] {
    const { months = 18, ...life } = options;
    const days = lifeDays(life);
    const random = new Random((life.seed ?? 20261122) + 1);

    const bought = days.length - Math.round((months * 365.25) / 12);
    return days.slice(Math.max(0, bought)).map((day) => dayFile(day, random));
}
