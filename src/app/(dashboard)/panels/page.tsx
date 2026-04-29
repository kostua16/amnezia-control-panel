import { PanelList } from '@/components/panels/panel-list';

export default function PanelsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Panels</h1>
        <p className="text-muted-foreground mt-1">
          Manage remote panels and connection status
        </p>
      </div>
      <PanelList />
    </div>
  );
}
