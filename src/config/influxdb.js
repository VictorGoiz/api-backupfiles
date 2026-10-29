import path from "node:path";
import dotenv from "dotenv";
import { InfluxDBClient } from "@influxdata/influxdb3-client";

dotenv.config({ path: path.resolve(import.meta.dirname, "../.env") });

const host = process.env.INFLUX_URL || process.env.INFLUXDB_HOST;
const token = process.env.INFLUX_TOKEN || process.env.INFLUXDB_TOKEN;

export const influxClient = new InfluxDBClient({
  host,
  token
});

export const influxDatabase =
  process.env.INFLUX_DATABASE || process.env.INFLUXDB_DATABASE;

export const influxMeasurement =
  process.env.INFLUX_MEASUREMENT ||
  process.env.INFLUXDB_MEASUREMENT ||
  "leituras_sensores";
