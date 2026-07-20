import { CoveHttpClient } from './http-client.js';

// Human-readable column names for the Cove RPC column codes
const CODE_TO_NAME: Record<string, string> = {
  I78: 'activeDataSources',
  T0: 'backupStatus',
  MN: 'computerName',
  AR: 'customer',
  AN: 'deviceName',
  OT: 'deviceType',
  T7: 'errors',
  TB: 'last28Days',
  TL: 'lastSuccessfulSession',
  YV: 'lsvStatus',
  OP: 'profile',
  PN: 'retentionPolicy',
  T3: 'selectedSize',
  YS: 'storageStatus',
  US: 'usedStorage'
};

export interface CoveAccountStatistics {
  AccountId: number;
  PartnerId: number;
  Flags?: string[] | null;
  Settings: Record<string, string>;
}

export interface CoveChildPartner {
  ActualChildCount: number;
  Info: {
    Id: number;
    Name: string;
    Level: string;
    ParentId: number;
    State: string;
  };
}

type RawStatisticsRow = {
  AccountId: number;
  PartnerId: number;
  Flags?: string[] | null;
  Settings: Array<Record<string, string | number | boolean | null>>;
};

type EnumerateAccountStatisticsResult = {
  result: RawStatisticsRow[];
};

type EnumerateChildPartnersResult = {
  result: {
    ActualChildCount: number;
    Children: CoveChildPartner[];
  };
};

export class CoveConnector {
  private client: CoveHttpClient;

  readonly account: {
    statistics: (partnerId: number) => Promise<CoveAccountStatistics[]>;
  };

  readonly partner: {
    children: {
      list: (partnerId: number) => Promise<CoveChildPartner[]>;
    };
  };

  constructor(server: string, clientId: string, clientSecret: string) {
    this.client = new CoveHttpClient(server, clientId, clientSecret);

    this.account = {
      statistics: (partnerId) => this.fetchStatistics(partnerId)
    };

    this.partner = {
      children: {
        list: (partnerId) => this.fetchChildPartners(partnerId)
      }
    };
  }

  async checkHealth(): Promise<boolean> {
    try {
      await this.client.getVisa();
      return true;
    } catch {
      return false;
    }
  }

  private async fetchChildPartners(partnerId: number): Promise<CoveChildPartner[]> {
    const result = await this.client.rpc<EnumerateChildPartnersResult>('EnumerateChildPartners', {
      partnerId,
      childrenLimit: 10000,
      range: { Offset: 0, Size: 10000 },
      fields: [0, 1, 3, 4, 5],
      partnerFilter: {
        SortOrder: 'ByLevelAndName',
        states: ['InProduction', 'InTrial', 'Expired']
      }
    });

    const children = result.result?.Children ?? [];
    const descendants = await Promise.all(
      children.map((child) =>
        child.ActualChildCount > 0 ? this.fetchChildPartners(child.Info.Id) : Promise.resolve([])
      )
    );

    return [...children, ...descendants.flat()];
  }

  private async fetchStatistics(partnerId: number): Promise<CoveAccountStatistics[]> {
    const result = await this.client.rpc<EnumerateAccountStatisticsResult>(
      'EnumerateAccountStatistics',
      {
        query: {
          PartnerId: partnerId,
          Filter: '',
          Labels: [],
          OrderBy: 'AR',
          RecordsCount: 200,
          SelectionMode: 'Merged',
          StartRecordNumber: 0,
          Totals: [],
          Columns: Object.keys(CODE_TO_NAME)
        }
      }
    );

    return (result.result ?? [])
      .filter((r) => r.PartnerId === partnerId)
      .map((r) => {
        const settings: Record<string, string> = {};
        for (const entry of r.Settings) {
          const [code, value] = Object.entries(entry)[0] ?? [];
          if (code && value !== undefined) {
            const name = CODE_TO_NAME[code];
            if (name) settings[name] = value == null ? '' : String(value);
          }
        }
        return {
          AccountId: r.AccountId,
          PartnerId: r.PartnerId,
          Flags: r.Flags ?? null,
          Settings: settings
        };
      });
  }
}
