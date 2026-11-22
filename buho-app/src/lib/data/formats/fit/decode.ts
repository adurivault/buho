/**
 * Reading Garmin's binary `.fit` files with the official SDK.
 *
 * A Garmin export is ~10k of these, and only two kinds matter: `activity` files
 * hold GPS tracks, `monitoringB` files hold the all-day step counters. Sleep,
 * HRV and respiration files are the majority by count; the parsers drop them by
 * `fileType`.
 */

/** A decoded message, keyed by the SDK's camelCase field names. */
export type FitMesg = Record<string, unknown>;

/** What one FIT file yielded, narrowed to the messages we read. */
export interface DecodedFit {
    /** `file_id.type`: 'activity', 'monitoringB', or a number for profile gaps. */
    fileType: string | number | undefined;
    recordMesgs: FitMesg[];
    sessionMesgs: FitMesg[];
    activityMesgs: FitMesg[];
    monitoringMesgs: FitMesg[];
    monitoringInfoMesgs: FitMesg[];
    /**
     * The health readings a monitoring file carries alongside its counters.
     * They ride in the same files as the steps, so reading them costs no extra
     * decoding — only the copy out of the SDK's result.
     */
    stressLevelMesgs: FitMesg[];
    respirationRateMesgs: FitMesg[];
    monitoringHrDataMesgs: FitMesg[];
}

type SdkModule = typeof import('@garmin/fitsdk');
let sdk: Promise<SdkModule> | null = null;

/**
 * The SDK ships the whole FIT profile and is only ever needed once a Garmin
 * export is actually dropped, so it is kept out of the main bundle — same
 * treatment as maplibre/deck in LocationMap. Memoised: a single import can hand
 * thousands of files to this.
 */
function loadSdk(): Promise<SdkModule> {
    if (!sdk) sdk = import('@garmin/fitsdk');
    return sdk;
}

/**
 * Decode one FIT file, or null if it isn't one.
 *
 * `checkIntegrity` is deliberately not called: it re-reads the whole buffer to
 * verify the CRC, doubling the cost of an import, and a file damaged enough to
 * matter surfaces as a decode error anyway.
 */
export async function decodeFit(bytes: Uint8Array): Promise<DecodedFit | null> {
    const { Decoder, Stream } = await loadSdk();

    const decoder = new Decoder(Stream.fromByteArray(bytes));
    if (!decoder.isFIT()) return null;

    const { messages } = decoder.read({
        // Unknown fields are a large share of an activity file and none of them
        // is read; skipping them is most of the decode budget.
        includeUnknownData: false,
        // Separate HR messages are only worth merging into records for beat-level
        // analysis, which no view does.
        mergeHeartRates: false,
    });

    return {
        fileType: (messages.fileIdMesgs?.[0] as FitMesg | undefined)?.type as
            string | number | undefined,
        recordMesgs: (messages.recordMesgs ?? []) as FitMesg[],
        sessionMesgs: (messages.sessionMesgs ?? []) as FitMesg[],
        activityMesgs: (messages.activityMesgs ?? []) as FitMesg[],
        monitoringMesgs: (messages.monitoringMesgs ?? []) as FitMesg[],
        monitoringInfoMesgs: (messages.monitoringInfoMesgs ?? []) as FitMesg[],
        stressLevelMesgs: (messages.stressLevelMesgs ?? []) as FitMesg[],
        respirationRateMesgs: (messages.respirationRateMesgs ?? []) as FitMesg[],
        monitoringHrDataMesgs: (messages.monitoringHrDataMesgs ?? []) as FitMesg[],
    };
}

/** The two file kinds Buho reads; everything else in the export is skipped. */
export const FIT_ACTIVITY = 'activity';
export const FIT_MONITORING = 'monitoringB';
