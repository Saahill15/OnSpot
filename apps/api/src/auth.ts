// Phone OTP login → JWT. Guards and role decorator.
import {
  BadRequestException, Body, CanActivate, Controller, createParamDecorator, ExecutionContext, HttpCode, Injectable,
  Post, SetMetadata, UnauthorizedException, ForbiddenException, HttpException, HttpStatus, Ip,
} from '@nestjs/common';

class TooManyRequestsException extends HttpException {
  constructor(message: string) { super(message, HttpStatus.TOO_MANY_REQUESTS); }
}
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { createHmac, randomInt } from 'crypto';
import { config, PrismaService, SmsService } from './infra';
import type { Role } from '@onspot/shared';

export interface AuthUser { sub: string; role: Role; name: string; }

const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private reflector: Reflector) {}
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const h: string = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) throw new UnauthorizedException('Sign in required');
    try { req.user = this.jwt.verify<AuthUser>(h.slice(7)); } catch { throw new UnauthorizedException('Session expired. Sign in again.'); }
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length && !roles.includes(req.user.role)) throw new ForbiddenException('Not allowed for your account type');
    return true;
  }
}

class RequestOtpDto {
  @Matches(/^[6-9]\d{9}$/, { message: 'Enter a valid 10-digit Indian mobile number' }) phone!: string;
}
class VerifyOtpDto {
  @Matches(/^[6-9]\d{9}$/) phone!: string;
  @Length(6, 6) code!: string;
  @IsIn(['CUSTOMER', 'PROVIDER', 'ADMIN']) role!: Role;
  @IsOptional() @IsString() @Length(2, 40) name?: string;
}

const hash = (phone: string, code: string) => createHmac('sha256', config.jwtSecret).update(`${phone}:${code}`).digest('hex');

@Controller('auth')
export class AuthController {
  constructor(private db: PrismaService, private jwt: JwtService, private sms: SmsService) {}

  /** Per-IP sliding window: stops one client spraying codes at many numbers (SMS costs money). */
  private static ipHits = new Map<string, number[]>();
  private ipAllowed(ip: string) {
    const now = Date.now(), win = 15 * 60e3;
    const hits = (AuthController.ipHits.get(ip) ?? []).filter(t => now - t < win);
    if (hits.length >= config.otpPerIpPer15Min) return false;
    hits.push(now); AuthController.ipHits.set(ip, hits);
    return true;
  }

  @Post('otp/request') @HttpCode(200)
  async requestOtp(@Body() { phone }: RequestOtpDto, @Ip() ip: string) {
    if (!this.ipAllowed(ip || 'unknown')) throw new TooManyRequestsException('Too many requests from this network. Try again later.');
    const recent = await this.db.otpCode.count({ where: { phone, createdAt: { gt: new Date(Date.now() - 15 * 60e3) } } });
    if (recent >= 5) throw new TooManyRequestsException('Too many codes requested. Try again in 15 minutes.');
    const code = String(randomInt(0, 1e6)).padStart(6, '0');
    await this.db.otpCode.create({ data: { phone, codeHash: hash(phone, code), expiresAt: new Date(Date.now() + 5 * 60e3) } });
    await this.sms.send(phone, `${code} is your OnSpot code. It expires in 5 minutes.`);
    return { sent: true, ...(config.otpDevEcho ? { devCode: code } : {}) };
  }

  @Post('otp/verify') @HttpCode(200)
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    const otp = await this.db.otpCode.findFirst({ where: { phone: dto.phone, usedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!otp || otp.expiresAt < new Date()) throw new BadRequestException('Code expired. Request a new one.');
    if (otp.attempts >= 5) throw new TooManyRequestsException('Too many wrong attempts. Request a new code.');
    if (otp.codeHash !== hash(dto.phone, dto.code)) {
      await this.db.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw new BadRequestException('Wrong code');
    }
    await this.db.otpCode.update({ where: { id: otp.id }, data: { usedAt: new Date() } });

    let user = await this.db.user.findUnique({ where: { phone_role: { phone: dto.phone, role: dto.role } } });
    if (!user) {
      if (dto.role === 'ADMIN') throw new ForbiddenException('No admin account for this number');
      if (!dto.name) return { needsName: true }; // client asks for the name, then verifies again with a fresh code
      user = await this.db.user.create({
        data: { phone: dto.phone, role: dto.role, name: dto.name.trim(), ...(dto.role === 'PROVIDER' ? { provider: { create: { services: [] } } } : {}) },
      });
    }
    const token = this.jwt.sign({ sub: user.id, role: user.role, name: user.name } satisfies AuthUser, { expiresIn: '30d' });
    return { token, user: { id: user.id, name: user.name, phone: user.phone, role: user.role } };
  }
}
