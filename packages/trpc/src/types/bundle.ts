export interface TrayItem {
  id: string;
  label: string;
  action: 'open_support';
}

export interface BundleData {
  branding: {
    companyName?: string;
    accentColor?: string;
    logoUrl?: string;
  };
  tray: {
    showTray: boolean;
    items: TrayItem[];
  };
}

export const DEFAULT_BUNDLE: BundleData = {
  branding: {},
  tray: {
    showTray: true,
    items: [{ id: 'support', label: 'Request Support', action: 'open_support' }],
  },
};
