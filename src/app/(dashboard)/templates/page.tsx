import { TemplateGalleryPage } from '@/components/templates/template-gallery-page';

export default function TemplatesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Templates</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Pre-built templates for protocols, servers, routing rules, and chain configurations.
        </p>
      </div>
      <TemplateGalleryPage />
    </div>
  );
}
