// Draws a Sensor Monitor style PDF (utils/sensorReport drawSensorReport) off
// the page's thread: a month of trips and fuel events for a unit is a table of
// hundreds of rows, and jspdf-autotable lays them out in one go.
//
// In:  buildSensorReport's argument   Out: { type: 'done', buffer } (transferred) | { type: 'error', message }

import { drawSensorReport } from '../utils/sensorReport';

self.onmessage = (e) => {
  try {
    const buffer = drawSensorReport(e.data).output('arraybuffer');
    self.postMessage({ type: 'done', buffer }, [buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: err?.message ?? String(err) });
  }
};
