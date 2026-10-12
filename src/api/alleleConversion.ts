import { invoke } from '@tauri-apps/api/tauri';
import { type db_AlleleConversion } from 'models/db/db_AlleleConversion';
import { type db_TableImport } from 'models/db/db_TableImport';
import { type AlleleConversionFieldName } from 'models/db/filter/db_AlleleConversionFieldName';
import { type FilterGroup, getDbBoolean } from 'models/db/filter/FilterGroup';

export const getAlleleConversions = async (): Promise<
  db_AlleleConversion[]
> => {
  return await invoke('get_allele_conversions');
};

export const getFilteredAlleleConversions = async (
  filter: FilterGroup<AlleleConversionFieldName>
): Promise<db_AlleleConversion[]> => {
  return await invoke('get_filtered_allele_conversions', { filter });
};

export const getCountFilteredAlleleConversions = async (
  filter: FilterGroup<AlleleConversionFieldName>
): Promise<number> => {
  return await invoke('get_count_filtered_allele_conversions', { filter });
};

/** The conversion rules that turn `alleleName` into another allele */
export const getConversionsOfAllele = async (
  alleleName: string
): Promise<db_AlleleConversion[]> => {
  return await getFilteredAlleleConversions({
    filters: [[['SourceAllele', { Equal: alleleName }]]],
    orderBy: [],
  });
};

/** Rejects (with the reason in the message) a product at another locus, a percent outside 0-100, or a missing allele or phenotype. */
export const insertDbAlleleConversion = async (
  record: db_AlleleConversion
): Promise<void> => {
  await invoke('insert_allele_conversion', { alleleConversion: record });
};

// Changes the percent converted and the description of a rule; the source,
// product and driver pick it.
export const updateDbAlleleConversion = async (
  record: db_AlleleConversion
): Promise<void> => {
  await invoke('update_allele_conversion', { alleleConversion: record });
};

/**
 * Imports a CSV/TSV file into this table in one transaction. Rows already in
 * the table are kept as they are; the result says how many rows the file held
 * and how many were new.
 */
export const insertAlleleConversionsFromFile = async (
  path: string
): Promise<db_TableImport> => {
  return await invoke('insert_allele_conversions_from_file', { path });
};

export const deleteFilteredAlleleConversions = async (
  filter: FilterGroup<AlleleConversionFieldName>
): Promise<void> => {
  await invoke('delete_filtered_allele_conversions', { filter });
};

export const deleteAlleleConversion = async (
  conversion: db_AlleleConversion
): Promise<void> => {
  await deleteFilteredAlleleConversions({
    filters: [
      [['SourceAllele', { Equal: conversion.sourceAllele }]],
      [['ProductAllele', { Equal: conversion.productAllele }]],
      [['DriverPhenotypeName', { Equal: conversion.driverPhenotypeName }]],
      [['DriverPhenotypeWild', getDbBoolean(conversion.driverPhenotypeWild)]],
    ],
    orderBy: [],
  });
};
