function normalizeRecipient(recipient: string): string {
  return recipient.trim();
}

function mailboxDomain(mailboxUpn: string): string | null {
  const atIndex = mailboxUpn.lastIndexOf('@');
  if (atIndex === -1 || atIndex === mailboxUpn.length - 1) return null;
  return mailboxUpn.slice(atIndex + 1).toLowerCase();
}

function extractEmailAddress(recipient: string): string | null {
  const smtpMatch = recipient.match(/\bSMTP:([^\]\s<>"]+@[^\]\s<>"]+)/i);
  if (smtpMatch?.[1]) return smtpMatch[1].toLowerCase();

  const emailMatch = recipient.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  return emailMatch?.[0]?.toLowerCase() ?? null;
}

export function isInternalInboxRuleRecipient(recipient: string, mailboxUpn: string): boolean {
  const normalized = normalizeRecipient(recipient);
  if (!normalized) return true;

  if (/^(EX|X500):/i.test(normalized)) return true;
  if (/^\/o=/i.test(normalized)) return true;
  if (/\[(EX|X500):/i.test(normalized)) return true;

  const email = extractEmailAddress(normalized);
  const domain = mailboxDomain(mailboxUpn);
  return Boolean(email && domain && email.endsWith(`@${domain}`));
}

export function isExternalInboxRuleRecipient(recipient: string, mailboxUpn: string): boolean {
  const normalized = normalizeRecipient(recipient);
  if (!normalized) return false;
  if (isInternalInboxRuleRecipient(normalized, mailboxUpn)) return false;

  const email = extractEmailAddress(normalized);
  if (email) return true;

  return /^SMTP:/i.test(normalized) || /\[SMTP:/i.test(normalized);
}

export function externalInboxRuleRecipients(
  recipients: string[] | null | undefined,
  mailboxUpn: string
): string[] {
  return (recipients ?? []).filter((recipient) =>
    isExternalInboxRuleRecipient(recipient, mailboxUpn)
  );
}
