import { describe, expect, it } from 'vitest';
import { normaliseSport, parseGpx, parseTcx } from './xml';

const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="StravaGPX" version="1.1" xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
 <metadata><time>2019-04-27T19:34:42Z</time></metadata>
 <trk>
  <name>Course a pied de nuit</name>
  <type>running</type>
  <trkseg>
   <trkpt lat="47.2059250" lon="-1.5642460">
    <ele>8.7</ele>
    <time>2019-04-27T19:34:42Z</time>
    <extensions><gpxtpx:TrackPointExtension>
      <gpxtpx:hr>92</gpxtpx:hr><gpxtpx:cad>81</gpxtpx:cad>
    </gpxtpx:TrackPointExtension></extensions>
   </trkpt>
   <trkpt lat="47.2059520" lon="-1.5642610">
    <ele>8.6</ele>
    <time>2019-04-27T19:34:44Z</time>
   </trkpt>
  </trkseg>
 </trk>
</gpx>`;

const TCX = `<?xml version='1.0' encoding='UTF-8'?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
 <Activities>
  <Activity Sport="Running">
   <Id>2014-05-25T14:59:41.795000+02:00</Id>
   <Lap StartTime="2014-05-25T14:59:41.795000+02:00">
    <Track>
     <Trackpoint><Time>2014-05-25T15:04:58.955000+02:00</Time><Extensions /></Trackpoint>
     <Trackpoint>
      <Time>2014-05-25T14:59:41.795000+02:00</Time>
      <Position><LatitudeDegrees>47.22794</LatitudeDegrees><LongitudeDegrees>-1.5520233</LongitudeDegrees></Position>
      <AltitudeMeters>12.5</AltitudeMeters>
      <DistanceMeters>0</DistanceMeters>
      <HeartRateBpm><Value>131</Value></HeartRateBpm>
      <Cadence>84</Cadence>
     </Trackpoint>
    </Track>
   </Lap>
  </Activity>
 </Activities>
</TrainingCenterDatabase>`;

describe('parseGpx', () => {
    it('reads the track, its sport and the sensors riding along', () => {
        const track = parseGpx(GPX)!;

        expect(track.sport).toBe('running');
        expect(track.fixes).toHaveLength(2);
        expect(track.fixes[0]).toMatchObject({
            ms: Date.parse('2019-04-27T19:34:42Z'),
            lat: 47.205925,
            lon: -1.564246,
            altitude: 8.7,
            heartRate: 92,
            cadence: 81,
        });
        expect(track.fixes[1].heartRate).toBeNull();
    });

    /**
     * The point of the whole `localOffset` detour: Strava normalises a `.gpx` to
     * UTC, so the file cannot say what time of day it was for whoever ran it.
     */
    it('reports no offset, because a Strava .gpx states none', () => {
        expect(parseGpx(GPX)!.offsetMinutes).toBeNull();
    });

    it('measures nothing a phone did not measure', () => {
        const [fix] = parseGpx(GPX)!.fixes;
        expect(fix.distance).toBeNull();
        expect(fix.speed).toBeNull();
    });

    it('yields nothing for a file with no positioned point in it', () => {
        expect(parseGpx('<gpx><trk><type>running</type><trkseg /></trk></gpx>')).toBeNull();
    });

    it('yields nothing for something that is not XML at all', () => {
        expect(parseGpx('not xml')).toBeNull();
    });
});

describe('parseTcx', () => {
    it('reads the trackpoints that carry a position', () => {
        const track = parseTcx(TCX)!;

        // The bare trackpoint is a lap marker, not a place anyone was.
        expect(track.fixes).toHaveLength(1);
        expect(track.fixes[0]).toMatchObject({
            lat: 47.22794,
            lon: -1.5520233,
            altitude: 12.5,
            distance: 0,
            heartRate: 131,
            cadence: 84,
        });
    });

    /** Unlike a `.gpx`, a `.tcx` states the offset it was recorded at. */
    it('keeps the offset the file states', () => {
        expect(parseTcx(TCX)!.offsetMinutes).toBe(120);
    });

    it('reads the sport off the activity', () => {
        expect(parseTcx(TCX)!.sport).toBe('running');
    });
});

describe('normaliseSport', () => {
    /**
     * `activity_type` is one shared string column, and the explorer facets it by
     * value: "Run" beside "running" is one activity split in two.
     */
    it('spells Strava’s sports the way the FIT files already do', () => {
        expect(normaliseSport('Run')).toBe('running');
        expect(normaliseSport('Ride')).toBe('cycling');
        expect(normaliseSport('Walk')).toBe('walking');
        expect(normaliseSport('Backcountry Ski')).toBe('backcountry_skiing');
    });

    it('leaves a sport it has no alias for alone, in lowercase', () => {
        expect(normaliseSport('Windsurf')).toBe('windsurf');
    });

    it('treats a numeric type code and an empty one as no sport at all', () => {
        expect(normaliseSport('9')).toBeNull();
        // What a `.fit` writes when the recorder never named a sport.
        expect(normaliseSport('generic')).toBeNull();
        expect(normaliseSport('  ')).toBeNull();
        expect(normaliseSport(null)).toBeNull();
    });
});
