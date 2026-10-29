import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { once } from "node:events";
import {
  mkdtemp,
  mkdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { ZipArchive } from "archiver";
import * as tus from "tus-js-client";

import {
  buscarLeituras,
  CAMPOS_SENSORES
} from "../repository/backupLFG60Repository.js";

const SEPARADOR_CSV = ";";

function formatarTimestamp(valor) {
  if (valor == null) return "";

  let data;
  if (valor instanceof Date) {
    data = valor;
  } else if (typeof valor === "number" || typeof valor === "bigint") {
    data = new Date(Number(valor));
  } else {
    data = new Date(String(valor));
  }

  if (Number.isNaN(data.getTime())) {
    return String(valor);
  }

  return data.toISOString();
}

function converterCSV(valor, coluna) {
  if (valor == null || valor === "") return "";

  if (coluna === "time") {
    return formatarTimestamp(valor);
  }

  if (typeof valor === "number" || typeof valor === "bigint") {
    return String(valor);
  }

  if (typeof valor === "boolean") {
    return valor ? "true" : "false";
  }

  const texto = valor instanceof Date ? valor.toISOString() : String(valor);

  // Proteção básica contra CSV Injection apenas quando não é número negativo
  const ehNumero = /^-?\d+(\.\d+)?$/.test(texto);
  if (ehNumero) {
    return texto;
  }

  const seguro = /^[=+\-@\t\r]/.test(texto) ? "'" + texto : texto;

  if (
    seguro.includes(SEPARADOR_CSV) ||
    seguro.includes('"') ||
    seguro.includes("\n") ||
    seguro.includes("\r")
  ) {
    return `"${seguro.replaceAll('"', '""')}"`;
  }

  return seguro;
}

function ordenarColunas(chavesLeitura) {
  const conjunto = new Set(["time", ...chavesLeitura, ...CAMPOS_SENSORES]);
  const metadados = [...conjunto].filter(
    (col) => col !== "time" && !CAMPOS_SENSORES.includes(col)
  );
  return ["time", ...metadados, ...CAMPOS_SENSORES];
}

async function gerarCSV(destino, inicio, fim) {
  const arquivo = fs.createWriteStream(destino, { encoding: "utf8" });
  let total = 0;
  let colunas = null;

  try {
    // BOM UTF-8 (\uFEFF) para que o Excel reconheça acentuação e separe as colunas por ';' automaticamente
    arquivo.write("\uFEFF");

    for await (const leitura of buscarLeituras(inicio, fim)) {
      if (!colunas) {
        colunas = ordenarColunas(Object.keys(leitura));

        if (!arquivo.write(colunas.join(SEPARADOR_CSV) + "\r\n")) {
          await once(arquivo, "drain");
        }
      }

      const linha =
        colunas
          .map((coluna) => converterCSV(leitura[coluna], coluna))
          .join(SEPARADOR_CSV) + "\r\n";

      if (!arquivo.write(linha)) {
        await once(arquivo, "drain");
      }

      total++;
    }

    if (!colunas) {
      colunas = ["time", ...CAMPOS_SENSORES];
      arquivo.write(colunas.join(SEPARADOR_CSV) + "\r\n");
    }

    arquivo.end();
    await once(arquivo, "finish");

    return total;
  } catch (erro) {
    arquivo.destroy();
    throw erro;
  }
}

async function gerarZIP(pasta, destino) {
  const output = fs.createWriteStream(destino);

  const zip = new ZipArchive({
    zlib: { level: 9 }
  });

  const concluido = new Promise((resolve, reject) => {
    output.once("close", resolve);
    output.once("error", reject);
    zip.once("error", reject);
  });

  zip.pipe(output);
  zip.directory(pasta, false);

  await zip.finalize();
  await concluido;
}

async function enviarSupabase(caminho, nome) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucketName = process.env.SUPABASE_BUCKET || "backup_sensimonitor";

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Credenciais do Supabase (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY) não configuradas no .env"
    );
  }

  const tamanho = (await stat(caminho)).size;
  const endpoint = `${supabaseUrl}/storage/v1/upload/resumable`;

  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(fs.createReadStream(caminho), {
      endpoint,
      uploadSize: tamanho,
      chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000],
      headers: {
        authorization: `Bearer ${supabaseKey}`,
        apikey: supabaseKey,
        "x-upsert": "true"
      },
      metadata: {
        bucketName,
        objectName: nome,
        contentType: "application/zip"
      },
      onError: reject,
      onSuccess: () => resolve(nome)
    });

    upload.start();
  });
}

function formatarDataTimezone(date, timeZone) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const mapa = Object.fromEntries(partes.map((p) => [p.type, p.value]));
  return `${mapa.year}-${mapa.month}-${mapa.day}`;
}

export async function executarBackupAutomatico(opcoes = {}) {
  const timezone = process.env.BACKUP_TIMEZONE || "America/Sao_Paulo";

  const agora = new Date();
  const vinteQuatroHorasAtras = new Date(agora.getTime() - 24 * 60 * 60 * 1000);

  const inicio = opcoes.inicio || null;
  const fim = opcoes.fim || null;

  const data = formatarDataTimezone(agora, timezone);

  const pastaTemporaria = await mkdtemp(
    path.join(os.tmpdir(), "sensorium-backup-")
  );

  const pastaConteudo = path.join(pastaTemporaria, "conteudo");
  const csv = path.join(pastaConteudo, `lfg60-${data}.csv`);
  const zip = path.join(pastaTemporaria, `lfg60-${data}.zip`);

  try {
    await mkdir(pastaConteudo, { recursive: true });

    console.log(`[Backup] Exportando leituras (${data})...`);

    const total = await gerarCSV(csv, inicio, fim);

    const manifesto = {
      dispositivo: "lfg60",
      measurement:
        process.env.INFLUX_MEASUREMENT ||
        process.env.INFLUXDB_MEASUREMENT ||
        "leituras_sensores",
      camposSensores: CAMPOS_SENSORES,
      data,
      inicio: inicio || vinteQuatroHorasAtras.toISOString(),
      fim: fim || agora.toISOString(),
      total,
      geradoEm: agora.toISOString()
    };

    await writeFile(
      path.join(pastaConteudo, "manifest.json"),
      JSON.stringify(manifesto, null, 2)
    );

    await gerarZIP(pastaConteudo, zip);

    const nome = `influxdb/lfg60-${data}.zip`;

    await enviarSupabase(zip, nome);

    console.log(`[Backup] Concluído: ${nome} (${total} leituras)`);

    return {
      sucesso: true,
      nome,
      total,
      periodo: {
        inicio: manifesto.inicio,
        fim: manifesto.fim
      }
    };
  } finally {
    await rm(pastaTemporaria, {
      recursive: true,
      force: true
    });
  }
}
