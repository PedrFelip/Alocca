import { PGlite } from '@electric-sql/pglite'
import { ForbiddenException } from '@nestjs/common'
import { drizzle } from 'drizzle-orm/pglite'
import { readFile, readdir } from 'node:fs/promises'
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import type { Database } from '../db/db.provider.ts'
import { CacheService } from '../cache/cache.service.ts'
import { createClient } from 'redis'
import type { ConfigService } from '@nestjs/config'
import type { Env } from '../config/env.ts'
import { GestoresService } from '../gestores/gestores.service.ts'
import { InstituicoesService } from './instituicoes.service.ts'
import { InstituicoesRepository } from './instituicoes.repository.ts'

describe('InstituicoesService — autorização com cache compartilhado', () => {
  let db: PGlite
  let service: InstituicoesService
  let repository: InstituicoesRepository
  let userA: string
  let userB: string
  let gestorA: string
  let institution: string
  const values = new Map<string, unknown>()
  let realCache: CacheService | undefined
  let admin: ReturnType<typeof createClient> | undefined
  let queryCount = 0
  const usedKeys = new Set<string>()
  const getOrLoad = vi.fn(
    async (
      key: string,
      ttl: number,
      load: () => Promise<unknown>,
      decode: (value: unknown) => unknown,
    ) => {
      usedKeys.add(key)
      if (realCache) return realCache.getOrLoad(key, ttl, load, decode)
      if (values.has(key)) return decode(values.get(key))
      const value = await load()
      try {
        decode(value)
        values.set(key, value)
      } catch {}
      return value
    },
  )

  beforeAll(async () => {
    db = new PGlite()
    for (const dir of (await readdir('drizzle')).sort()) {
      await db.exec(await readFile(`drizzle/${dir}/migration.sql`, 'utf8'))
    }
    const database = drizzle({
      client: db,
      logger: {
        logQuery: () => {
          queryCount++
        },
      },
    }) as unknown as Database
    if (process.env.CACHE_TEST_REDIS_URL) {
      const url = process.env.CACHE_TEST_REDIS_URL
      realCache = new CacheService({
        get: (name: string) => (name === 'REDIS_URL' ? url : undefined),
      } as unknown as ConfigService<Env, true>)
      await (
        realCache as unknown as { client: ReturnType<typeof createClient> }
      ).client.connect()
      admin = createClient({ url })
      await admin.connect()
    }
    repository = new InstituicoesRepository(database)
    service = new InstituicoesService(
      repository,
      new GestoresService(database),
      {
        getOrLoad,
        defaultTtlSeconds: 60,
      } as unknown as CacheService,
    )
    const users = await db.query<{ id: string }>(
      "INSERT INTO usuarios (nome, email, senha_hash, tipo) VALUES ('A', 'cache-a@example.com', 'hash', 'GESTOR'), ('B', 'cache-b@example.com', 'hash', 'GESTOR') RETURNING id",
    )
    ;[userA, userB] = users.rows.map((row) => row.id)
    const gestores = await db.query<{ id: string }>(
      'INSERT INTO gestores (usuario_id) VALUES ($1), ($2) RETURNING id',
      [userA, userB],
    )
    gestorA = gestores.rows[0].id
    const inserted = await db.query<{ id: string }>(
      "INSERT INTO instituicoes (usuario_id, nome, cnpj) VALUES ($1, 'Hospital', '12345678901234') RETURNING id",
      [userA],
    )
    institution = inserted.rows[0].id
    await db.query(
      'INSERT INTO gestores_instituicoes (gestor_id, instituicao_id) VALUES ($1, $2)',
      [gestorA, institution],
    )
  }, 30000)
  afterAll(async () => {
    if (admin?.isOpen) {
      const keys = [...usedKeys].flatMap((key) => [
        `alocca:cache:data:${key}`,
        `alocca:cache:version:${key}`,
      ])
      if (keys.length) await admin.del(keys)
      await admin.close()
    }
    realCache?.onModuleDestroy()
    await db?.close()
  })

  it('reflete edição SQL direta, ordena várias instituições e usa consultas em lote', async () => {
    const inserted = await db.query<{ id: string }>(
      "INSERT INTO instituicoes (usuario_id, nome, cnpj) VALUES ($1, 'Alfa', '22345678901234'), ($1, 'Zulu', '32345678901234') RETURNING id",
      [userA],
    )
    for (const row of inserted.rows)
      await db.query(
        'INSERT INTO gestores_instituicoes (gestor_id, instituicao_id) VALUES ($1, $2)',
        [gestorA, row.id],
      )
    queryCount = 0
    const first = await service.vinculadas(userA)
    expect(first.map((row) => row.nome)).toEqual(['Alfa', 'Hospital', 'Zulu'])
    expect(queryCount).toBeLessThanOrEqual(3)
    const before = await db.query<{ updated_at: Date; cache_revisao: string }>(
      'SELECT updated_at, cache_revisao FROM instituicoes WHERE id = $1',
      [institution],
    )
    await db.query("UPDATE instituicoes SET nome = 'Aardvark' WHERE id = $1", [
      institution,
    ])
    const after = await db.query<{ updated_at: Date; cache_revisao: string }>(
      'SELECT updated_at, cache_revisao FROM instituicoes WHERE id = $1',
      [institution],
    )
    expect(after.rows[0].updated_at).toEqual(before.rows[0].updated_at)
    expect(after.rows[0].cache_revisao).not.toBe(before.rows[0].cache_revisao)
    expect((await service.vinculadas(userA)).map((row) => row.nome)).toEqual([
      'Aardvark',
      'Alfa',
      'Zulu',
    ])
    await db.query("UPDATE instituicoes SET nome = 'Hospital' WHERE id = $1", [
      institution,
    ])
    for (const row of inserted.rows)
      await db.query(
        'DELETE FROM gestores_instituicoes WHERE instituicao_id = $1',
        [row.id],
      )
    getOrLoad.mockClear()
  })

  it('rollback preserva dados e revisão da instituição', async () => {
    const before = await db.query<{ nome: string; cache_revisao: string }>(
      'SELECT nome, cache_revisao FROM instituicoes WHERE id = $1',
      [institution],
    )
    await db.exec('BEGIN')
    try {
      await db.query(
        "UPDATE instituicoes SET nome = 'Descartado' WHERE id = $1",
        [institution],
      )
      const during = await db.query<{ cache_revisao: string }>(
        'SELECT cache_revisao FROM instituicoes WHERE id = $1',
        [institution],
      )
      expect(during.rows[0].cache_revisao).not.toBe(
        before.rows[0].cache_revisao,
      )
    } finally {
      await db.exec('ROLLBACK')
    }
    const after = await db.query<{ nome: string; cache_revisao: string }>(
      'SELECT nome, cache_revisao FROM instituicoes WHERE id = $1',
      [institution],
    )
    expect(after.rows[0]).toEqual(before.rows[0])
  })

  it('não publica dados B sob revisão A quando a fonte volta a A', async () => {
    values.clear()
    await db.query("UPDATE instituicoes SET nome = 'Corrida A' WHERE id = $1", [
      institution,
    ])
    const revision = await repository.revisao(gestorA)
    const revisionSpy = vi.spyOn(repository, 'revisao')
    // Uma alteração depois da consulta de revisão ocorre imediatamente antes do loader.
    const original = getOrLoad.getMockImplementation()!
    getOrLoad.mockImplementationOnce(async (key, ttl, load, decode) => {
      return original(
        key,
        ttl,
        async () => {
          await db.query(
            "UPDATE instituicoes SET nome = 'Corrida B' WHERE id = $1",
            [institution],
          )
          return load()
        },
        decode,
      )
    })
    expect((await service.vinculadas(userA))[0].nome).toBe('Corrida B')
    const oldKey = `instituicoes:vinculadas:${gestorA}:${revision}`
    if (admin) expect(await admin.exists(`alocca:cache:data:${oldKey}`)).toBe(0)
    else expect(values.has(oldKey)).toBe(false)
    await db.query("UPDATE instituicoes SET nome = 'Hospital' WHERE id = $1", [
      institution,
    ])
    // Força uma nova consulta sob revisão A: ela deve carregar a fonte atual,
    // nunca devolver B como se B tivesse sido publicado sob A.
    revisionSpy.mockResolvedValueOnce(revision)
    expect((await service.vinculadas(userA))[0].nome).toBe('Hospital')
    revisionSpy.mockRestore()
    getOrLoad.mockClear()
  })

  it('revalida vínculo, estado da instituição e perfil mesmo com detalhes em cache', async () => {
    expect(await service.vinculadas(userA)).toMatchObject([
      { id: institution, nome: 'Hospital' },
    ])
    expect(await service.vinculadas(userB)).toEqual([])
    expect(getOrLoad).toHaveBeenCalledTimes(1)
    await db.query('DELETE FROM gestores_instituicoes WHERE gestor_id = $1', [
      gestorA,
    ])
    expect(await service.vinculadas(userA)).toEqual([])
    await db.query(
      'INSERT INTO gestores_instituicoes (gestor_id, instituicao_id) VALUES ($1, $2)',
      [gestorA, institution],
    )
    await db.query('UPDATE instituicoes SET ativa = false WHERE id = $1', [
      institution,
    ])
    expect(await service.vinculadas(userA)).toEqual([])
    await db.query(
      'UPDATE instituicoes SET ativa = true, deleted_at = now() WHERE id = $1',
      [institution],
    )
    expect(await service.vinculadas(userA)).toEqual([])
    await db.query('UPDATE gestores SET ativa = false WHERE id = $1', [gestorA])
    await expect(service.vinculadas(userA)).rejects.toBeInstanceOf(
      ForbiddenException,
    )
  })
})
