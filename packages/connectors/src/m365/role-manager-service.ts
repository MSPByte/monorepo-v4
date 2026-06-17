import type { M365Connector } from './connector.js';

export class Microsoft365RoleManagerService {
  constructor(private connector: M365Connector) {}

  async ensureDirectoryRoles(
    requiredRoles: Record<string, string>
  ): Promise<{ assigned: string[]; failed: string[] }> {
    let spId: string;
    try {
      const sp = await this.connector.servicePrincipals.findOwn();
      if (!sp) return { assigned: [], failed: Object.keys(requiredRoles) };
      spId = sp.id;
    } catch (err) {
      console.error('Failed to find Service Principals:', err);
      return { assigned: [], failed: Object.keys(requiredRoles) };
    }

    const assigned: string[] = [];
    const failed: string[] = [];

    for (const [name, roleDefinitionId] of Object.entries(requiredRoles)) {
      try {
        await this.connector.roleManagement.directory.roleAssignments.create(
          spId,
          roleDefinitionId
        );
        assigned.push(name);
      } catch (err) {
        console.log('Failed to assign role:', name, `[${err}]`, `[${spId}]`);
        failed.push(name);
      }
    }

    return { assigned, failed };
  }
}
