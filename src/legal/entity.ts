export type LegalEntity = {
  product_name: string;
  legal_entity_name: string;
  legal_form: string;
  registered_address: string;
  trade_license_number: string;
  privacy_email: string;
  support_email: string;
  legal_email: string;
  copyright_email: string;
  security_email: string;
  governing_law: string;
  dispute_forum: string;
  merchant_of_record: string;
  merchant_of_record_url: string;
};

const UNSET = "";

export const LEGAL_ENTITY: LegalEntity = {
  product_name: "Drama Space",
  legal_entity_name: UNSET,
  legal_form: UNSET,
  registered_address: UNSET,
  trade_license_number: UNSET,
  privacy_email: UNSET,
  support_email: UNSET,
  legal_email: UNSET,
  copyright_email: UNSET,
  security_email: UNSET,
  governing_law: UNSET,
  dispute_forum: UNSET,
  merchant_of_record: UNSET,
  merchant_of_record_url: UNSET,
};

const REQUIRED_TO_PUBLISH: (keyof LegalEntity)[] = [
  "legal_entity_name",
  "legal_form",
  "registered_address",
  "privacy_email",
  "support_email",
  "legal_email",
  "copyright_email",
  "governing_law",
  "dispute_forum",
];

export function isLegalIdentityComplete(entity: LegalEntity = LEGAL_ENTITY): boolean {
  return REQUIRED_TO_PUBLISH.every((key) => entity[key].trim().length > 0);
}

export function displayField(value: string, placeholder: string): string {
  return value.trim() || placeholder;
}

export function operatorLine(entity: LegalEntity = LEGAL_ENTITY): string {
  const name = displayField(entity.legal_entity_name, "[LEGAL_ENTITY_NAME]");
  return `${entity.product_name} is operated by ${name} (“Company”, “we”, “us”, or “our”).`;
}

export function contactOrPlaceholder(
  value: string,
  placeholder: string,
): { href: string | null; label: string } {
  if (value.trim()) {
    return { href: `mailto:${value.trim()}`, label: value.trim() };
  }
  return { href: null, label: placeholder };
}
