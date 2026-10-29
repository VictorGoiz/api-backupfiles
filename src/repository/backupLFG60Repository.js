import {
  influxClient,
  influxDatabase,
  influxMeasurement
} from "../config/influxdb.js";

export const CAMPOS_SENSORES = [
  "temperatura",
  "umidade",
  "co2",
  "voc",
  "pm25",
  "pm10",
  "formaldeido",
  "led"
];

export async function* buscarLeituras(inicio, fim) {
  const measurement = influxMeasurement;

  if (!measurement || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(measurement)) {
    throw new Error("Measurement inválida");
  }

  const filtroTempo =
    inicio && fim
      ? `time >= '${inicio}' AND time < '${fim}'`
      : `time >= now() - interval '24 hour'`;

  const filtroSensores = CAMPOS_SENSORES
    .map((campo) => `"${campo}" IS NOT NULL`)
    .join(" OR ");

  const sql = `
    SELECT *
    FROM "${measurement}"
    WHERE
      ${filtroTempo}
      AND (${filtroSensores})
    ORDER BY time ASC
  `;

  const resultado = await influxClient.query(sql, influxDatabase);

  for await (const leitura of resultado) {
    yield leitura;
  }
}
