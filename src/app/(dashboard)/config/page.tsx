import { ConfigList } from '@/components/config/config-list';

export default function ConfigPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Configuration</h1>
        <p className="text-muted-foreground mt-1">
          Manage configuration templates, presets, import and export settings
        </p>
      </div>
      <ConfigList />
    </div>
  );
}
