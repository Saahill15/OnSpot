import 'reflect-metadata';
import { Logger, Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { AuthController, AuthGuard, AuthUser } from './auth';
import { AdminController, JobsController, MeController, PaymentsController, PlacesController, ProviderController, PublicController } from './controllers';
import { config, GeoService, PlacesService, PrismaService, PushService, RealtimeService, SmsService } from './infra';
import { JobsService } from './jobs.service';

/** Socket.IO: clients connect with { auth: { token } } and are joined to their own room (and `admins`). */
@WebSocketGateway({ cors: { origin: true } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  constructor(private jwt: JwtService, private rt: RealtimeService) {}
  afterInit(server: Server) { this.rt.server = server; }
  handleConnection(socket: Socket) {
    try {
      const u = this.jwt.verify<AuthUser>(String(socket.handshake.auth?.token || ''));
      socket.join(`user:${u.sub}`);
      if (u.role === 'ADMIN') socket.join('admins');
      socket.emit('ready', { userId: u.sub });
    } catch { socket.emit('error', 'unauthorized'); socket.disconnect(true); }
  }
}

@Module({
  imports: [JwtModule.register({ global: true, secret: config.jwtSecret })],
  controllers: [AuthController, PublicController, MeController, JobsController, PaymentsController, ProviderController, PlacesController, AdminController],
  providers: [PrismaService, GeoService, SmsService, PushService, PlacesService, RealtimeService, JobsService, AuthGuard, RealtimeGateway],
})
export class AppModule {}

export async function createApp() {
  const app = await NestFactory.create(AppModule, { logger: process.env.NODE_ENV === 'test' ? ['error'] : undefined });
  app.enableCors({ origin: true });
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false }));
  app.enableShutdownHooks();
  return app;
}

if (require.main === module) {
  createApp().then(async app => {
    await app.listen(config.port);
    new Logger('OnSpot').log(`API ready on http://localhost:${config.port}/v1`);
  });
}
