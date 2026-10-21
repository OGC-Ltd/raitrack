// Mock live feed event templates.



const LIVE_FEED = [
  { time: "07:12", type: "success",  text: "KBU 123A · T. Ochieng departed Sukari Industries, Thika. Cargo: 38t Raw Sugar Cane. ETA Mombasa Port Depot 14:30." },
  { time: "07:45", type: "info",     text: "KCA 112X · A. Otieno checked in at Thika Sugar Factory weighbridge. Load confirmed: 31t Processed Sugar." },
  { time: "08:03", type: "warning",  text: "ALERT: KDA 456B · J. Mutua detected at 112 km/h on A109 near Athi River. Speed limit 80 km/h. Driver notified." },
  { time: "08:21", type: "info",     text: "KBG 234D · P. Kipchoge arrived Nakuru Depot #3. Offloading 35t Processed Sugar. Dock 4 assigned." },
  { time: "08:47", type: "critical", text: "CRITICAL: KBP 789L · F. Mwangi, fuel level dropped 22L in 30 min while stationary near Malindi. Possible theft. Security alerted." },
  { time: "09:05", type: "success",  text: "KDD 890T · V. Njeri completed mandatory 45-min rest stop at Mtito Andei weighbridge. Journey resumed." },
  { time: "09:18", type: "info",     text: "KBZ 334Y · L. Kamau en route Nairobi Distribution Hub. Currently at Gilgil. ETA 11:20. Cargo intact." },
  { time: "09:33", type: "warning",  text: "KDC 890F · M. Njoroge exited designated geofence boundary near Nakuru. Route deviation of 4.2 km detected." },
  { time: "09:51", type: "info",     text: "New dispatch: KDH 778D · F. Chebet assigned 28t Processed Sugar. Departure Eldoret Grain Store to Nakuru Depot #3." },
  { time: "10:04", type: "success",  text: "KBV 012M · G. Wekesa delivered 33t Processed Sugar to Kisumu Sugar Mill. POD signed. Return trip scheduled." },
  { time: "10:22", type: "warning",  text: "KDD 567Z · M. Achieng, engine temperature elevated at +94°C near Mumias. Driver advised to reduce speed and check coolant." },
  { time: "10:39", type: "info",     text: "KDF 123J · R. Koech vehicle KDF 123J engine switched off at Eldoret Grain Store. Scheduled loading in progress." },
  { time: "10:55", type: "critical", text: "CRITICAL: KDD 890T · V. Njeri, speeding 97 km/h on Thika–Mombasa highway. Second violation today. Supervisor notified." },
  { time: "11:10", type: "success",  text: "KDE 234R · B. Omondi arrived Thika Sugar Factory from Nyeri Farm Co-op. 41t Raw Sugar Cane offloaded successfully." },
  { time: "11:28", type: "info",     text: "COF reminder: KBW 678P · C. Wambui certificate of fitness expires in 5 days. Schedule inspection at Garissa NTSA office." },
  { time: "11:45", type: "info",     text: "KDF 230B · P. Kariuki en route Nairobi CBD Warehouse. Currently Kangundo. 33t Processed Sugar. ETA 13:00." },
  { time: "12:02", type: "success",  text: "KDC 445C · J. Okello cleared Busia border checkpoint. Export documents verified. Proceeding to Nakuru Depot #3." },
  { time: "12:18", type: "warning",  text: "KDE 901A · S. Njuguna, vehicle idle for 42 min at Juja. No activity logged. Driver unresponsive. Dispatch contacted." },
  { time: "12:34", type: "info",     text: "KDJ 789W · A. Maina departed Kitale Farm Store. Cargo: 37t Raw Sugar Cane bound for Eldoret Grain Store. Journey time est. 1h 20min." },
  { time: "12:50", type: "success",  text: "KDH 901M · P. Wafula completed delivery to Nairobi CBD Warehouse. 34t Raw Sugar Cane accepted. Return authorised." },
];

const LIVE_FEED_BY_COMPANY = {
  sukari: LIVE_FEED,
};


export default LIVE_FEED_BY_COMPANY;
