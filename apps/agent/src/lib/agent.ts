import { invoke } from '@tauri-apps/api/core';
import { Logger, type APIResponse } from '@/lib/logger';

export type SystemInfo = {
  hostname: string;
  ip_address?: string;
  ext_address?: string;
  mac_address?: string;
  guid?: string;
  version?: string;
  username?: string;
};

export async function getSystemInfo(): Promise<APIResponse<SystemInfo>> {
  try {
    const content = await invoke<SystemInfo>('get_os_info');
    if (!content) throw 'No system info found';

    return {
      data: content,
    };
  } catch (err) {
    return Logger.error({
      module: 'Agent',
      context: 'getSystemInfo',
      message: `Failed to get system info: ${err}`,
    });
  }
}
