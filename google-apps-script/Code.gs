/**
 * =========================================================================================
 * GOOGLE MEET ATTENDANCE & IN/OUT AUTOMATION SCRIPT
 * =========================================================================================
 * 
 * Features:
 * - Automatically records IN & OUT timestamps when participants join or leave.
 * - Accurately calculates session duration and total active time.
 * - Dual sheet tabs:
 *   1. "Attendance Summary": Consolidated row per participant (updates live).
 *   2. "Activity Log": Real-time audit trail of every JOINED and LEFT event.
 * =========================================================================================
 */

const SUMMARY_SHEET_NAME = "Attendance Summary";
const LOG_SHEET_NAME = "Activity Log";

const SUMMARY_HEADERS = [
  "Participant Name",
  "Meeting Code",
  "Meeting Title",
  "Date",
  "First Joined Time",
  "Last Left Time",
  "Total Time (Mins)",
  "Total Time (HH:MM:SS)",
  "Join Count",
  "Current Status",
  "Last Updated"
];

const LOG_HEADERS = [
  "Timestamp",
  "Meeting Code",
  "Meeting Title",
  "Participant Name",
  "Event Type",
  "Event Time",
  "Session Duration",
  "Total Cumulative Time",
  "Remarks"
];

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: "ok",
    message: "Google Meet Attendance Webhook is active and listening!"
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: "Server busy, could not acquire lock"
    })).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    const rawData = e.postData ? e.postData.contents : "";
    if (!rawData) {
      return ContentService.createTextOutput(JSON.stringify({
        status: "error",
        message: "No data payload received"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    const payload = JSON.parse(rawData);
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // Health check ping
    if (payload.action === "ping" || payload.action === "test") {
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        message: "Connection successfully verified! Spreadsheet: " + ss.getName()
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // Ensure sheets and headers exist
    const summarySheet = getOrCreateSheet(ss, SUMMARY_SHEET_NAME, SUMMARY_HEADERS);
    const logSheet = getOrCreateSheet(ss, LOG_SHEET_NAME, LOG_HEADERS);

    // Process event
    if (payload.event === "JOINED" || payload.event === "LEFT" || payload.event === "BATCH_SYNC" || payload.event === "UPDATE") {
      processAttendanceEvent(ss, summarySheet, logSheet, payload);
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      message: "Event logged successfully"
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function processAttendanceEvent(ss, summarySheet, logSheet, data) {
  const meetingCode = data.meetingCode || "Unknown";
  const meetingTitle = data.meetingTitle || meetingCode;
  const participantName = data.name ? data.name.trim() : "Guest";
  const eventType = data.event || "UPDATE";
  const eventTime = data.eventTime || formatDateTime(new Date());
  const dateStr = data.date || formatDate(new Date());
  const sessionDuration = data.sessionDuration || "00:00:00";
  const totalDurationStr = data.totalDurationStr || "00:00:00";
  const totalMinutes = data.totalMinutes !== undefined ? Number(data.totalMinutes).toFixed(1) : "0.0";
  const firstJoinedTime = data.firstJoinedTime || eventTime;
  const lastLeftTime = eventType === "LEFT" ? eventTime : (data.lastLeftTime || "-");
  const joinCount = data.joinCount || 1;
  const status = eventType === "LEFT" ? "Left" : "In Call";
  const remarks = data.remarks || (eventType === "JOINED" ? (joinCount > 1 ? "Rejoined" : "Joined") : "Left meeting");

  // 1. Append to Activity Log Sheet
  logSheet.appendRow([
    new Date(),
    meetingCode,
    meetingTitle,
    participantName,
    eventType,
    eventTime,
    eventType === "JOINED" ? "-" : sessionDuration,
    totalDurationStr,
    remarks
  ]);

  // Color code the event cell
  const lastLogRow = logSheet.getLastRow();
  const eventCell = logSheet.getRange(lastLogRow, 5);
  if (eventType === "JOINED") {
    eventCell.setBackground("#E8F5E9").setFontColor("#1B5E20").setFontWeight("bold");
  } else if (eventType === "LEFT") {
    eventCell.setBackground("#FFEBEE").setFontColor("#B71C1C").setFontWeight("bold");
  }

  // 2. Insert or Update in Attendance Summary Sheet
  const dataRange = summarySheet.getDataRange();
  const values = dataRange.getValues();
  let foundRowIndex = -1;

  for (let i = 1; i < values.length; i++) {
    const rowName = values[i][0] ? values[i][0].toString().trim() : "";
    const rowCode = values[i][1] ? values[i][1].toString().trim() : "";
    if (rowName.toLowerCase() === participantName.toLowerCase() && (rowCode === meetingCode || rowCode === "")) {
      foundRowIndex = i + 1;
      break;
    }
  }

  const nowFormatted = formatDateTime(new Date());

  if (foundRowIndex > 0) {
    const existingFirstJoin = values[foundRowIndex - 1][4] || firstJoinedTime;

    summarySheet.getRange(foundRowIndex, 1, 1, SUMMARY_HEADERS.length).setValues([[
      participantName,
      meetingCode,
      meetingTitle,
      dateStr,
      existingFirstJoin,
      lastLeftTime,
      totalMinutes,
      totalDurationStr,
      joinCount,
      status,
      nowFormatted
    ]]);

    const statusCell = summarySheet.getRange(foundRowIndex, 10);
    if (status === "In Call") {
      statusCell.setBackground("#E8F5E9").setFontColor("#1B5E20").setFontWeight("bold");
    } else {
      statusCell.setBackground("#F5F5F5").setFontColor("#616161").setFontWeight("normal");
    }
  } else {
    summarySheet.appendRow([
      participantName,
      meetingCode,
      meetingTitle,
      dateStr,
      firstJoinedTime,
      lastLeftTime,
      totalMinutes,
      totalDurationStr,
      joinCount,
      status,
      nowFormatted
    ]);

    const newRow = summarySheet.getLastRow();
    const statusCell = summarySheet.getRange(newRow, 10);
    if (status === "In Call") {
      statusCell.setBackground("#E8F5E9").setFontColor("#1B5E20").setFontWeight("bold");
    }
  }
}

function getOrCreateSheet(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    formatHeaderRow(sheet, headers.length);
  } else {
    const firstRowValues = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (headers.length !== firstRowValues.length || firstRowValues[1] !== headers[1]) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      formatHeaderRow(sheet, headers.length);
    }
  }
  return sheet;
}

function formatHeaderRow(sheet, colCount) {
  const headerRange = sheet.getRange(1, 1, 1, colCount);
  headerRange.setBackground("#0F9D58");
  headerRange.setFontColor("#FFFFFF");
  headerRange.setFontWeight("bold");
  headerRange.setHorizontalAlignment("center");
  headerRange.setVerticalAlignment("middle");
  sheet.setRowHeight(1, 36);
  sheet.setFrozenRows(1);
  for (let col = 1; col <= colCount; col++) {
    sheet.autoResizeColumn(col);
  }
}

function formatDate(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function formatDateTime(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
}
