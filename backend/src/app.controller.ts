import { AppService } from './app.service.js'

type HealthCheckResponse = {
  status: string
  timestamp: string
}

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello()
  }

  @Get('health')
  healthCheck(): HealthCheckResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    }
  }
}
import { Controller, Get } from '@nestjs/common'
