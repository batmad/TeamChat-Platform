import { AppError } from "@/lib/api/app-error";
import { INTEGRATION_TARGET_FIELDS, type FieldMappingRecord, type IntegrationTargetField, type SourceField } from "@/lib/integrations/types";

export type MappingReadiness = {
  requiredTargets: IntegrationTargetField[];
  configuredTargets: string[];
  missingTargets: IntegrationTargetField[];
  mappingComplete: boolean;
  mappingRevision: number;
  previewedMappingRevision: number | null;
  lastMappingPreviewAt: Date | string | null;
  previewCurrent: boolean;
  canActivate: boolean;
};

export function validateMappingDefinition(mappings: FieldMappingRecord[]): void {
  const targetSet = new Set<string>();
  for (const mapping of mappings) {
    if (!INTEGRATION_TARGET_FIELDS.includes(mapping.targetField as IntegrationTargetField)) {
      throw new AppError(400, "INVALID_TARGET_MAPPING", `Unsupported target field: ${mapping.targetField}`);
    }
    if (targetSet.has(mapping.targetField)) {
      throw new AppError(400, "DUPLICATE_TARGET_MAPPING", `Target field ${mapping.targetField} can only be mapped once`);
    }
    targetSet.add(mapping.targetField);
  }

  const missing = INTEGRATION_TARGET_FIELDS.filter((target) => !targetSet.has(target));
  if (missing.length) {
    throw new AppError(400, "REQUIRED_MAPPING_MISSING", `Required mappings are missing: ${missing.join(", ")}`);
  }
}

export function validateMappingsAgainstSourceFields(
  mappings: FieldMappingRecord[],
  fields: SourceField[],
): void {
  validateMappingDefinition(mappings);
  const available = new Set(fields.map((field) => field.name));
  const missingSourceFields = mappings
    .filter((mapping) => !available.has(mapping.sourceField))
    .map((mapping) => mapping.sourceField);

  if (missingSourceFields.length) {
    throw new AppError(
      422,
      "SOURCE_FIELD_NOT_FOUND",
      `Mapped source fields were not found: ${[...new Set(missingSourceFields)].join(", ")}`,
    );
  }
}

export function buildMappingReadiness(input: {
  mappings: Array<{ targetField: string }>;
  mappingRevision: number;
  previewedMappingRevision: number | null;
  lastMappingPreviewAt: Date | string | null;
}): MappingReadiness {
  const configuredTargets = [...new Set(input.mappings.map((mapping) => mapping.targetField))].sort();
  const missingTargets = INTEGRATION_TARGET_FIELDS.filter((target) => !configuredTargets.includes(target));
  const mappingComplete = missingTargets.length === 0;
  const previewCurrent = mappingComplete && input.previewedMappingRevision === input.mappingRevision;

  return {
    requiredTargets: [...INTEGRATION_TARGET_FIELDS],
    configuredTargets,
    missingTargets,
    mappingComplete,
    mappingRevision: input.mappingRevision,
    previewedMappingRevision: input.previewedMappingRevision,
    lastMappingPreviewAt: input.lastMappingPreviewAt,
    previewCurrent,
    canActivate: mappingComplete && previewCurrent,
  };
}
