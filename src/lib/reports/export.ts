import ExcelJS from "exceljs";
import type { ChatLogsReportRow } from "@/lib/reports/chat-logs";

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function rowToFlat(row: ChatLogsReportRow) {
  return {
    timestamp: row.timestamp,
    chatType: row.chatType,
    groups: row.groupContexts
      .map((group) => `${group.code} - ${group.name}`)
      .join(" | "),
    roomId: row.roomId,
    roomName: row.roomName ?? "",
    senderUsername: row.senderUsername,
    senderName: row.senderName ?? "",
    participants: row.participants
      .map(
        (participant) =>
          `${participant.username}${participant.name ? ` - ${participant.name}` : ""}`,
      )
      .join(" | "),
    message: row.message,
    replyTo: row.replyTo
      ? `${row.replyTo.senderUsername}: ${row.replyTo.content}`
      : "",
    messageId: row.id,
  };
}

export function createChatLogsCsv(rows: ChatLogsReportRow[]) {
  const headers = [
    "Timestamp",
    "Chat Type",
    "Group Context",
    "Room ID",
    "Room Name",
    "Sender Username",
    "Sender Name",
    "Participants",
    "Message",
    "Reply To",
    "Message ID",
  ];
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) {
    const flat = rowToFlat(row);
    lines.push(
      [
        flat.timestamp,
        flat.chatType,
        flat.groups,
        flat.roomId,
        flat.roomName,
        flat.senderUsername,
        flat.senderName,
        flat.participants,
        flat.message,
        flat.replyTo,
        flat.messageId,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `\uFEFF${lines.join("\r\n")}`;
}

export async function createChatLogsXlsx(rows: ChatLogsReportRow[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Syssca TeamChat Platform";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Chat Logs");
  sheet.columns = [
    { header: "Timestamp", key: "timestamp", width: 25 },
    { header: "Chat Type", key: "chatType", width: 14 },
    { header: "Group Context", key: "groups", width: 30 },
    { header: "Room ID", key: "roomId", width: 38 },
    { header: "Room Name", key: "roomName", width: 24 },
    { header: "Sender Username", key: "senderUsername", width: 22 },
    { header: "Sender Name", key: "senderName", width: 24 },
    { header: "Participants", key: "participants", width: 40 },
    { header: "Message", key: "message", width: 60 },
    { header: "Reply To", key: "replyTo", width: 45 },
    { header: "Message ID", key: "messageId", width: 38 },
  ];
  for (const row of rows) sheet.addRow(rowToFlat(row));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: "K1" };
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
