export type AccessRole = "admin" | "user";

export type Access = {
  role: AccessRole;
  beta: boolean;
  isAdmin: boolean;
  allowed: boolean;
};

export function accessFromAppMetadata(metadata: Record<string, unknown> | undefined): Access {
  const role: AccessRole = metadata?.role === "admin" ? "admin" : "user";
  const beta = metadata?.beta === true;
  return {
    role,
    beta,
    isAdmin: role === "admin",
    allowed: role === "admin" || beta,
  };
}
