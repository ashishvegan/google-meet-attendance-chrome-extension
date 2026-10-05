# 🎓 Google Meet Attendance & IN/OUT Tracker (Chrome Extension)

An automated Manifest V3 Chrome Extension that continuously detects invitees joining and leaving Google Meet, calculates their active session & cumulative durations, and **automatically syncs attendance directly to your Google Spreadsheet in real-time**.

---

## 📊 Suggested Google Sheet Header Columns

Our automation organizes your spreadsheet into **two purpose-built sheets**:

### Option 1: `Attendance Summary` Sheet (Consolidated Roster)
> *Maintains **one consolidated row per participant** showing their first arrival, last departure, rejoin count, total active duration, and current status.*

| Column # | Suggested Header Column Name | Description | Example Data |
| :--- | :--- | :--- | :--- |
| **A** | **`Participant Name`** | Full name of the invitee | `Ashish Labade` |
| **B** | **`Participant Email`** | Email address (captured from Google Meet / Workspace) | `ashish@example.com` |
| **C** | **`Meeting Code`** | Google Meet call code | `abc-defg-hij` |
| **D** | **`Meeting Title`** | Meeting subject / title | `Daily Standup & Sync` |
| **E** | **`Date`** | Date of the session (`YYYY-MM-DD`) | `2026-10-05` |
| **F** | **`First Joined Time`** | When the person first entered | `09:00:15 AM` |
| **G** | **`Last Left Time`** | When they finally exited (or `-` if in call) | `10:02:40 AM` |
| **H** | **`Total Time (Mins)`** | Total duration in decimal minutes | `62.4` |
| **I** | **`Total Time (HH:MM:SS)`** | Formatted duration | `01:02:25` |
| **J** | **`Join Count`** | How many times they re-joined | `1` (or `2` if reconnected) |
| **K** | **`Current Status`** | Active status in call | `In Call` or `Left` |
| **L** | **`Last Updated`** | Timestamp of last sync event | `2026-10-05 10:02:40` |

---

### Option 2: `Activity Log` Sheet (Real-Time IN/OUT Audit Trail)
> *Appends a new record **every single time** someone joins or leaves the call.*

| Column # | Header Column Name | Description | Example Data |
| :--- | :--- | :--- | :--- |
| **A** | **`Timestamp`** | Exact system timestamp | `2026-10-05 09:00:15` |
| **B** | **`Meeting Code`** | Call code | `abc-defg-hij` |
| **C** | **`Meeting Title`** | Meeting subject | `Team Sync` |
| **D** | **`Participant Name`** | Name of invitee | `John Doe` |
| **E** | **`Participant Email`** | Email address | `john@example.com` |
| **F** | **`Event Type`** | Action (`JOINED` / `LEFT`) | `JOINED` / `LEFT` |
| **G** | **`Event Time`** | Local time of the event | `09:00:15 AM` |
| **H** | **`Session Duration`** | Duration of this specific stay | `00:00:10` (or `-` on join) |
| **I** | **`Total Cumulative Time`** | Total accumulated time in call | `00:00:10` |
| **J** | **`Remarks`** | Context note | `First Joined` / `Left meeting` |

> 💡 **Good News**: You don't need to manually type or format these headers! The included Google Apps Script will **automatically generate, format, color-code, and freeze both header rows** the first time an event is received!

---

## 🚀 Setup Guide (Takes ~2 Minutes)

### Step 1: Set Up Google Spreadsheet & Apps Script

1. Open [Google Sheets](https://sheets.new) and create a new blank spreadsheet.
2. Name it (e.g. `Google Meet Attendance 2026`).
3. In the top menu, click **Extensions** > **Apps Script**.
4. In the code editor window:
   - Erase any default code.
   - Open the file [`google-apps-script/Code.gs`](file:///d:/AshishVegan.WorkSpace/Web.Apps/2026/Google.Meet.Attendance.Recorder/google-apps-script/Code.gs) in this project.
   - Copy and paste its entire content into the Apps Script editor.
   - Click the **Save** icon (disk).
5. Deploy as Web App:
   - In the top right, click **Deploy** > **New deployment**.
   - Click the gear icon next to "Select type" and choose **Web app**.
   - **Description**: `Google Meet Attendance Tracker`
   - **Execute as**: `Me (your email)`
   - **Who has access**: `Anyone` *(Crucial: enables the extension to post attendance events)*.
   - Click **Deploy**.
   - Google will ask to authorize permissions. Click **Authorize access**, choose your account, click **Advanced** > **Go to Untitled project (unsafe)**, and **Allow**.
6. **Copy the Web App URL** displayed on the screen (ends in `/exec`).

---

### Step 2: Install the Chrome Extension

1. Open Google Chrome and navigate to:
   ```text
   chrome://extensions
   ```
2. In the top right corner, enable **Developer mode**.
3. In the top left corner, click **Load unpacked**.
4. Select the directory of this project:
   ```text
   d:\AshishVegan.WorkSpace\Web.Apps\2026\Google.Meet.Attendance.Recorder
   ```
5. The extension **"Google Meet Attendance & In/Out Tracker"** will now appear in your Chrome toolbar!
6. Click the extension icon > go to the **Google Sheets** tab:
   - Paste your **Web App URL**.
   - Click **Test Connection** (you should see a green verification message).
   - Click **Save Settings**.

---

### Step 3: Test in Google Meet

1. Join any Google Meet call (e.g. `https://meet.google.com`).
2. Notice the sleek floating **Attendance** badge at the top-right of your Google Meet screen.
3. As participants join or leave:
   - The extension detects them automatically.
   - Google Spreadsheet instantly updates **Attendance Summary** and logs each join/exit in **Activity Log**.
   - You can click the floating badge or extension icon at any time to see the live attendee list, elapsed time, or download an instant **CSV** file.

---

## 🛠️ Features

- 🟢 **Automatic IN / OUT Logging**: Tracks when invitees enter, drop off, or reconnect.
- ⏱️ **Duration & Reconnection Tracking**: Computes total active minutes and session durations.
- 📡 **Direct Google Sheet Auto-Sync**: No OAuth client setup required; leverages Google Apps Script Web App.
- 🛡️ **Anti-Flicker Grace Period**: Prevents false "left" triggers if network stutters or during Google Meet DOM repaints.
- 📁 **Offline Resilient**: Queues events if offline and flushes them when reconnected.
- 📄 **1-Click CSV Export**: Instant download from the floating widget or popup.
- 🎨 **Modern Dark Glassmorphic Design**: Designed according to modern UI aesthetics.
