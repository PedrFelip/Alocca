import { Module } from '@nestjs/common'
import { CacheService } from './cache.service.ts'

@Module({ providers: [CacheService], exports: [CacheService] })
export class CacheModule {}
