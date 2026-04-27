export interface Configuration {
  id: number;
  type: string;
  name: string;
  content: Record<string, unknown>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  serviceId: number | null;
}

export interface ConfigTemplate {
  type: string;
  name: string;
  description: string;
  variables: ConfigVariable[];
}

export interface ConfigVariable {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  defaultValue: string | number | boolean;
  options?: string[];
}
