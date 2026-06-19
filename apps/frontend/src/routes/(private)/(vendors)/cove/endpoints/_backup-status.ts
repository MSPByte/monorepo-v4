export const BACKUP_STATUS_COLORS: Record<string, string> = {
  "5": "bg-green-500",
  "2": "bg-destructive",
  "8": "bg-amber-500",
  "3": "bg-orange-500",
  "0": "bg-muted-foreground/30",
  "6": "bg-orange-200/70",
  "7": "bg-red-500/70",
  c: "bg-orange-700",
};

export const BACKUP_STATUS_LABEL: Record<string, string> = {
  "5": "Completed",
  "2": "Failed",
  "8": "Completed with Errors",
  "3": "Aborted",
  "0": "No Backup",
  "6": "Interrupted",
  "7": "Not Started",
  c: "Restarted",
};
