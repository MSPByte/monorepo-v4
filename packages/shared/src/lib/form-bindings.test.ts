import { describe, expect, test } from 'bun:test';
import {
  collectPackageRuntimeInputs,
  validateFormPackageBindings,
} from './form-bindings.js';
import { formWantsEntraIdentity } from '../types/agent-forms.js';

const pkg = {
  steps: [{
    kind: 'capability',
    capabilityId: 'm365.group.add-member',
    inputBindings: {
      user: { kind: 'runtime', promptKey: 'traveler', required: true },
      expires: { kind: 'runtime', promptKey: 'return_date', required: true },
    },
  }],
  outcomeSteps: {
    onSuccess: [],
    onFailure: [{
      kind: 'capability',
      capabilityId: 'halopsa.ticket.note',
      inputBindings: {
        ticket: { kind: 'runtime', promptKey: 'ticket_id', required: true },
      },
    }],
  },
  prompts: [
    { id: 'traveler', label: 'Traveler', required: true },
    { id: 'return_date', label: 'Return date', required: true },
    { id: 'ticket_id', label: 'Ticket', required: true },
  ],
};

const metas: Record<string, Record<string, { typeHint: string }>> = {
  'm365.group.add-member': { user: { typeHint: 'upn' }, expires: { typeHint: 'date' } },
  'halopsa.ticket.note': { ticket: { typeHint: 'text' } },
};

describe('form package bindings', () => {
  test('collects runtime inputs from main and failure lanes', () => {
    const result = collectPackageRuntimeInputs(pkg, id => metas[id] ?? null);
    expect(result.inputs.map(input => input.promptKey)).toEqual(['traveler', 'return_date', 'ticket_id']);
  });

  test('accepts verified identity, date field, and created ticket mappings', () => {
    const collection = collectPackageRuntimeInputs(pkg, id => metas[id] ?? null);
    const bindings = {
      traveler: { kind: 'system' as const, key: 'entra_upn' as const },
      return_date: { kind: 'formField' as const, fieldId: 'return' },
      ticket_id: { kind: 'system' as const, key: 'ticket_id' as const },
    };
    expect(validateFormPackageBindings({
      collection,
      bindings,
      formFieldTypes: { return: 'date' },
    })).toEqual([]);
    expect(formWantsEntraIdentity(bindings)).toBe(true);
  });

  test('rejects missing required and incompatible form fields', () => {
    const collection = collectPackageRuntimeInputs(pkg, id => metas[id] ?? null);
    const errors = validateFormPackageBindings({
      collection,
      bindings: { return_date: { kind: 'formField', fieldId: 'confirmed' } },
      formFieldTypes: { confirmed: 'checkbox' },
    });
    expect(errors).toContain('Required package input "Traveler" has no value source');
    expect(errors).toContain('"Return date" cannot be filled from a checkbox field');
    expect(errors).toContain('Required package input "Ticket" has no value source');
  });

  test('rejects an empty fixed value for a required input', () => {
    const collection = collectPackageRuntimeInputs(pkg, id => metas[id] ?? null);
    const errors = validateFormPackageBindings({
      collection,
      bindings: {
        traveler: { kind: 'literal', value: '   ' },
        return_date: { kind: 'literal', value: '2026-10-01' },
        ticket_id: { kind: 'system', key: 'ticket_id' },
      },
      formFieldTypes: {},
    });
    expect(errors).toContain('Required package input "Traveler" has an empty fixed value');
  });
});
