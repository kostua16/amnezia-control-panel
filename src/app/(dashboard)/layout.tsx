export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar placeholder — Phase 1.6 */}
      <aside className="hidden md:flex w-64 border-r bg-muted/40">
        <div className="p-4 text-muted-foreground text-sm">Sidebar</div>
      </aside>
      <div className="flex-1 flex flex-col">
        {/* Header placeholder — Phase 1.6 */}
        <header className="h-14 border-b bg-background flex items-center px-6">
          <span className="text-muted-foreground text-sm">Header</span>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
