export type SophosTamperProtectionGet = {
  enabled: boolean;
  password: string;
  previousPasswords?:
    | Array<{
        password: string;
        invalidatedAt: string;
      }>
    | {
        password: string;
        invalidatedAt: string;
      };
};
