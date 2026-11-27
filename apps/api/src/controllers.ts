// HTTP API. Thin controllers: validation + auth here, rules live in JobsService.
import { BadRequestException, Body, Controller, ForbiddenException, Get, GoneException, Header, HttpCode, NotFoundException, Param, Patch, Post, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { createReadStream, existsSync } from 'fs';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { Prisma } from '@prisma/client';
import { ACTIVE_STATUSES, EVENTS, isServiceCode, PRICING, SERVICES, ServiceCode } from '@onspot/shared';
import { AuthGuard, AuthUser, CurrentUser, Roles } from './auth';
import { GeoService, PlacesService, PrismaService, PushService, RealtimeService } from './infra';
import { JobsService, jobView, trustOf, verifyPhotoSig } from './jobs.service';

// ---------------------------------------------------------------- DTOs
class Point { @IsLatitude() lat!: number; @IsLongitude() lng!: number; @IsOptional() @IsString() @Length(0, 120) label?: string; }
class QuoteDto {
  @IsString() service!: string;
  @ValidateNested() @Type(() => Point) pickup!: Point;
  @IsOptional() @ValidateNested() @Type(() => Point) drop?: Point;
  @IsOptional() @IsBoolean() night?: boolean;
}
class CreateJobDto extends QuoteDto {
  @IsOptional() @IsString() @Length(0, 300) notes?: string;
  @IsOptional() @IsString() @Length(0, 60) vehicle?: string;
  @IsOptional() @IsBoolean() topRatedOnly?: boolean;
}
class TipDto { @IsInt() @Min(10) @Max(2000) amount!: number; }
class PhotoDto {
  @IsIn(['BEFORE', 'AFTER']) kind!: 'BEFORE' | 'AFTER';
  @IsIn(['image/jpeg', 'image/png', 'image/webp']) mime!: string;
  @IsString() @Length(100, 7_500_000) data!: string; // base64, ≤ ~5 MB decoded
}
class DisputeDto {
  @IsIn(['OVERCHARGED', 'NO_SHOW', 'BAD_SERVICE', 'DAMAGE', 'SAFETY', 'OTHER']) reason!: string;
  @IsOptional() @IsString() @Length(0, 500) details?: string;
}
class ResolveDisputeDto { @IsString() @Length(3, 500) resolution!: string; @IsInt() @Min(0) refundAmount!: number; }
class CodeDto { @Matches(/^\d{4}$/, { message: 'Enter the 4-digit code' }) code!: string; }
class AddonDto { @IsString() @Length(1, 60) label!: string; @IsInt() @Min(1) @Max(50000) amount!: number; @IsOptional() @IsString() @Length(0, 120) reason?: string; }
class DecisionDto { @IsBoolean() approve!: boolean; }
class PayDto { @IsIn(['upi', 'card', 'cash']) method!: string; }
class RateDto { @IsInt() @Min(1) @Max(5) stars!: number; @IsOptional() @IsString() @Length(0, 300) comment?: string; }
class MessageDto { @IsString() @Length(1, 500) text!: string; }
class CancelDto { @IsOptional() @IsString() @Length(0, 80) reason?: string; }
class LocationDto { @IsLatitude() lat!: number; @IsLongitude() lng!: number; }
class LocationQuery { @Type(() => Number) @IsLatitude() lat!: number; @Type(() => Number) @IsLongitude() lng!: number; }
class StatusDto { @IsBoolean() online!: boolean; @IsOptional() @IsLatitude() lat?: number; @IsOptional() @IsLongitude() lng?: number; }
class ProviderProfileDto { @IsOptional() @IsArray() @ArrayMaxSize(8) services?: string[]; @IsOptional() @IsString() @Length(0, 20) vehicleNo?: string; }
class KycDto {
  @IsIn(['AADHAAR', 'PAN']) idType!: string;
  @Matches(/^\d{4}$/, { message: 'Last 4 digits of your ID' }) idLast4!: string;
  @IsString() @Length(5, 20) dlNumber!: string;
  @Matches(/^[\w.\-]{2,}@[a-zA-Z]{2,}$/, { message: 'Enter a valid UPI ID' }) upiId!: string;
}
class Contact { @IsString() @Length(1, 40) name!: string; @Matches(/^[6-9]\d{9}$/) phone!: string; }
class Vehicle { @IsString() @Length(0, 40) model!: string; @IsString() @Length(0, 15) plate!: string; @IsIn(['petrol', 'diesel', 'cng', 'ev']) fuel!: string; }
class ProfileDto {
  @IsOptional() @IsArray() @ArrayMaxSize(3) @ValidateNested({ each: true }) @Type(() => Contact) contacts?: Contact[];
  @IsOptional() @ValidateNested() @Type(() => Vehicle) vehicle?: Vehicle;
  @IsOptional() @IsBoolean() shield?: boolean;
}
class RazorpayVerifyDto { @IsString() jobId!: string; @IsString() razorpay_order_id!: string; @IsString() razorpay_payment_id!: string; @IsString() razorpay_signature!: string; }
class KycDecisionDto { @IsBoolean() approve!: boolean; }
class SuspendDto { @IsBoolean() suspended!: boolean; @IsOptional() @IsString() @Length(0, 120) reason?: string; }
class PushTokenDto {
  @Matches(/^Expo(nent)?PushToken\[[\w-]+\]$/, { message: 'Invalid Expo push token' }) token!: string;
  @IsOptional() @IsIn(['ios', 'android', 'web', 'unknown']) platform: string = 'unknown';
}

// ---------------------------------------------------------------- public
@Controller()
export class PublicController {
  constructor(private db: PrismaService, private jobs: JobsService, private geo: GeoService) {}
  @Get('health') health() { return { ok: true, geo: this.geo.index.kind }; }
  @Get('catalog') catalog() { return { services: SERVICES, pricing: PRICING }; }
  /** Family tracking link: no codes, phones, chat or notes. */
  /** Proof-of-work photo. The link is signed and expires (see photoUrl), so photos aren't publicly listable. */
  @Get('photos/:id') @Header('Cache-Control', 'private, max-age=3600')
  async photo(@Param('id') id: string, @Query('exp') exp: string, @Query('sig') sig: string) {
    if (!verifyPhotoSig(id, +exp, String(sig || ''))) throw new ForbiddenException('This photo link has expired');
    const f = await this.jobs.photoFile(id);
    if (!existsSync(f.path)) throw new NotFoundException('Photo not found');
    return new StreamableFile(createReadStream(f.path), { type: f.mime });
  }
  @Get('track/:id') async track(@Param('id') id: string) {
    const j = await this.jobs.load(id);
    // Privacy: family links stop working 2 hours after the trip ends.
    if (!ACTIVE_STATUSES.includes(j.status as any)) {
      const endedAt = j.paidAt ?? j.completedAt ?? j.events.at(-1)?.at ?? j.createdAt;
      if (Date.now() - endedAt.getTime() > 2 * 3600_000) throw new GoneException('This tracking link has expired');
    }
    return jobView(j, 'public');
  }
}

// ---------------------------------------------------------------- me (any signed-in user)
@Controller('me') @UseGuards(AuthGuard)
export class MeController {
  constructor(private db: PrismaService) {}
  private view(u: any) { return { id: u.id, name: u.name, phone: u.phone, role: u.role, contacts: u.contacts, vehicle: u.vehicle, shieldUntil: u.shieldUntil, shield: !!u.shieldUntil && u.shieldUntil > new Date() }; }
  @Get() async me(@CurrentUser() u: AuthUser) { return this.view(await this.db.user.findUniqueOrThrow({ where: { id: u.sub } })); }
  /** Register this device for push. Re-registering moves the token to the current user (shared phones). */
  @Post('push-tokens') @HttpCode(200) async addToken(@CurrentUser() u: AuthUser, @Body() b: PushTokenDto) {
    await this.db.pushToken.upsert({ where: { token: b.token }, create: { token: b.token, userId: u.sub, platform: b.platform }, update: { userId: u.sub, platform: b.platform } });
    return { ok: true };
  }
  @Post('push-tokens/remove') @HttpCode(200) async removeToken(@CurrentUser() u: AuthUser, @Body() b: PushTokenDto) {
    await this.db.pushToken.deleteMany({ where: { token: b.token, userId: u.sub } });
    return { ok: true };
  }
  @Patch() async update(@CurrentUser() u: AuthUser, @Body() b: ProfileDto) {
    const data: Prisma.UserUpdateInput = {};
    if (b.contacts) data.contacts = b.contacts as unknown as Prisma.InputJsonValue;
    if (b.vehicle) data.vehicle = { ...b.vehicle, plate: b.vehicle.plate.toUpperCase() };
    if (b.shield === true) data.shieldUntil = new Date(Date.now() + 30 * 864e5); // payment for the plan goes via the gateway in prod
    if (b.shield === false) data.shieldUntil = null;
    return this.view(await this.db.user.update({ where: { id: u.sub }, data }));
  }
}

// ---------------------------------------------------------------- jobs
@Controller('jobs') @UseGuards(AuthGuard)
export class JobsController {
  constructor(private jobs: JobsService, private db: PrismaService) {}

  @Post('quote') @HttpCode(200) @Roles('CUSTOMER') quote(@CurrentUser() u: AuthUser, @Body() b: QuoteDto) { return this.jobs.quote(u, b); }
  @Post() @Roles('CUSTOMER') create(@CurrentUser() u: AuthUser, @Body() b: CreateJobDto) { return this.jobs.create(u, b); }

  @Get() async mine(@CurrentUser() u: AuthUser) {
    const where = u.role === 'PROVIDER' ? { providerId: u.sub } : { customerId: u.sub };
    const list = await this.db.job.findMany({ where, orderBy: { createdAt: 'desc' }, take: 30, select: { id: true } });
    const out = [];
    for (const { id } of list) out.push(jobView(await this.jobs.load(id), u.role === 'PROVIDER' ? 'provider' : 'customer'));
    return out;
  }
  @Get('availability') @Roles('CUSTOMER') availability(@Query() q: LocationQuery) { return this.jobs.availability({ lat: q.lat, lng: q.lng }); }
  @Get(':id') async get(@CurrentUser() u: AuthUser, @Param('id') id: string) { const j = await this.jobs.load(id); return jobView(j, this.jobs.viewerOf(j, u)); }

  @Post(':id/accept') @HttpCode(200) @Roles('PROVIDER') accept(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.jobs.accept(u, id); }
  @Post(':id/decline') @HttpCode(200) @Roles('PROVIDER') decline(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.jobs.decline(u, id); }
  @Post(':id/arrived') @HttpCode(200) @Roles('PROVIDER') arrived(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.jobs.arrived(u, id); }
  @Post(':id/start') @HttpCode(200) @Roles('PROVIDER') start(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: CodeDto) { return this.jobs.start(u, id, b.code); }
  @Post(':id/addons') @HttpCode(200) @Roles('PROVIDER') addon(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: AddonDto) { return this.jobs.proposeAddon(u, id, b); }
  @Post(':id/addons/:addonId/decision') @HttpCode(200) @Roles('CUSTOMER') decide(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('addonId') a: string, @Body() b: DecisionDto) { return this.jobs.decideAddon(u, id, a, b.approve); }
  @Post(':id/complete') @HttpCode(200) @Roles('PROVIDER') complete(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.jobs.complete(u, id); }
  @Post(':id/pay') @HttpCode(200) @Roles('CUSTOMER') pay(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: PayDto) { return this.jobs.pay(u, id, b.method); }
  @Post(':id/rate') @HttpCode(200) rate(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: RateDto) { return this.jobs.rate(u, id, b.stars, b.comment); }
  @Post(':id/messages') @HttpCode(200) message(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: MessageDto) { return this.jobs.message(u, id, b.text); }
  @Post(':id/photos') @HttpCode(200) @Roles('PROVIDER') photo(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: PhotoDto) { return this.jobs.addPhoto(u, id, b.kind, b.data, b.mime); }
  @Post(':id/cash-received') @HttpCode(200) @Roles('PROVIDER') cash(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.jobs.cashReceived(u, id); }
  @Post(':id/tip') @HttpCode(200) @Roles('CUSTOMER') tip(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: TipDto) { return this.jobs.tip(u, id, b.amount); }
  @Post(':id/dispute') @HttpCode(200) @Roles('CUSTOMER') dispute(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: DisputeDto) { return this.jobs.dispute(u, id, b.reason, b.details); }
  @Post(':id/switch') @HttpCode(200) @Roles('CUSTOMER') switchPro(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.jobs.switchPro(u, id); }
  @Post(':id/sos') @HttpCode(200) @Roles('CUSTOMER') sos(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.jobs.sos(u, id); }
  @Post(':id/cancel') @HttpCode(200) cancel(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: CancelDto) { return this.jobs.cancel(u, id, b.reason); }
}

@Controller('payments') @UseGuards(AuthGuard)
export class PaymentsController {
  constructor(private jobs: JobsService) {}
  @Post('razorpay/verify') @HttpCode(200) @Roles('CUSTOMER') verify(@CurrentUser() u: AuthUser, @Body() b: RazorpayVerifyDto) { return this.jobs.verifyRazorpay(u, b); }
}

// ---------------------------------------------------------------- provider (partner app)
@Controller('provider') @UseGuards(AuthGuard) @Roles('PROVIDER')
export class ProviderController {
  constructor(private db: PrismaService, private geo: GeoService, private jobs: JobsService, private rt: RealtimeService) {}

  @Get('me') async me(@CurrentUser() u: AuthUser) {
    const p = await this.db.provider.findUniqueOrThrow({ where: { userId: u.sub }, include: { user: true } });
    let active = p.activeJobId ? jobView(await this.jobs.load(p.activeJobId), 'provider') : null;
    if (!active) {
      // A finished job where the customer chose cash still needs the partner to confirm receipt, even after an app restart.
      const cash = await this.db.job.findFirst({ where: { providerId: u.sub, status: 'COMPLETED', payment: { status: 'PENDING_CASH' } }, orderBy: { completedAt: 'desc' }, select: { id: true } });
      if (cash) active = jobView(await this.jobs.load(cash.id), 'provider');
    }
    return { provider: this.view(p), activeJob: active, offers: p.activeJobId ? [] : await this.jobs.offersFor(u.sub) };
  }
  private view(p: any) {
    return { trust: trustOf(p), id: p.userId, name: p.user?.name, services: p.services, vehicleNo: p.vehicleNo, online: p.online, lat: p.lat, lng: p.lng, rating: +p.rating.toFixed(2), ratingCount: p.ratingCount, kycStatus: p.kycStatus, suspended: p.suspended, earnings: p.earnings, jobsDone: p.jobsDone, activeJobId: p.activeJobId };
  }
  @Patch('me') async update(@CurrentUser() u: AuthUser, @Body() b: ProviderProfileDto) {
    if (b.services && !b.services.every(isServiceCode)) throw new BadRequestException('Unknown service');
    const p = await this.db.provider.update({ where: { userId: u.sub }, data: { services: b.services, vehicleNo: b.vehicleNo?.toUpperCase() }, include: { user: true } });
    if (p.online && !p.activeJobId && p.lat != null) await this.geo.index.upsert(p.userId, p.lat, p.lng!, p.services as ServiceCode[]);
    return this.view(p);
  }
  @Post('kyc') @HttpCode(200) async kyc(@CurrentUser() u: AuthUser, @Body() b: KycDto) {
    const p = await this.db.provider.findUniqueOrThrow({ where: { userId: u.sub } });
    if (!['PENDING', 'REJECTED'].includes(p.kycStatus)) throw new BadRequestException(`KYC is already ${p.kycStatus.toLowerCase()}`);
    // Production: verify via DigiLocker / KYC vendor and store document images in private object storage.
    const upd = await this.db.provider.update({ where: { userId: u.sub }, data: { kycStatus: 'SUBMITTED', kycDocs: { ...b, submittedAt: new Date().toISOString() } }, include: { user: true } });
    this.rt.toAdmins('provider.updated', this.view(upd));
    return this.view(upd);
  }
  @Post('status') @HttpCode(200) async status(@CurrentUser() u: AuthUser, @Body() b: StatusDto) {
    const p = await this.db.provider.findUniqueOrThrow({ where: { userId: u.sub } });
    if (b.online) {
      if (p.suspended) throw new ForbiddenException('Your account is suspended. Contact OnSpot partner support.');
      if (p.kycStatus !== 'VERIFIED') throw new ForbiddenException(p.kycStatus === 'SUBMITTED' ? 'Your KYC is under review' : 'Complete KYC before going online');
      if (!p.services.length) throw new BadRequestException('Choose at least one service you offer');
      if ((b.lat ?? p.lat) == null) throw new BadRequestException('Share your location to go online');
    }
    const upd = await this.db.provider.update({ where: { userId: u.sub }, data: { online: b.online, lat: b.lat ?? p.lat, lng: b.lng ?? p.lng }, include: { user: true } });
    if (upd.online && !upd.activeJobId) await this.geo.index.upsert(upd.userId, upd.lat!, upd.lng!, upd.services as ServiceCode[]);
    else await this.geo.index.remove(upd.userId);
    this.rt.toAdmins('provider.updated', this.view(upd));
    return this.view(upd);
  }
  @Post('location') @HttpCode(200) location(@CurrentUser() u: AuthUser, @Body() b: LocationDto) { return this.jobs.providerLocation(u.sub, b); }
  @Get('hotspots') hotspots(@CurrentUser() u: AuthUser) { return this.jobs.hotspots(u.sub); }
}

@Controller('places') @UseGuards(AuthGuard)
export class PlacesController {
  constructor(private places: PlacesService) {}
  /** Real nearby garages for "tow to" (OpenStreetMap). Empty list → the app offers "choose on map". */
  @Get('garages') garages(@Query() q: LocationQuery) { return this.places.garages(q.lat, q.lng); }
}

// ---------------------------------------------------------------- ops / admin
@Controller('admin') @UseGuards(AuthGuard) @Roles('ADMIN')
export class AdminController {
  constructor(private db: PrismaService, private rt: RealtimeService, private geo: GeoService, private jobSvc: JobsService, private push: PushService) {}

  /** Everything the live map needs in one call. */
  @Get('live') async live() {
    const [providers, jobs] = await Promise.all([
      this.db.provider.findMany({ where: { online: true, lat: { not: null } }, include: { user: true } }),
      this.db.job.findMany({ where: { status: { in: ACTIVE_STATUSES } }, include: { customer: true, provider: { include: { user: true } } }, orderBy: { createdAt: 'desc' } }),
    ]);
    return {
      providers: providers.map(p => ({ id: p.userId, name: p.user.name, lat: p.lat, lng: p.lng, services: p.services, onJob: !!p.activeJobId })),
      jobs: jobs.map(j => ({ id: j.id, status: j.status, service: j.service, total: j.total, pickup: { lat: j.pickupLat, lng: j.pickupLng, label: j.pickupLabel }, customer: j.customer.name, provider: j.provider?.user.name ?? null, createdAt: j.createdAt, eta: j.eta })),
    };
  }
  @Get('jobs/:id') async job(@Param('id') id: string) { return jobView(await this.jobSvc.load(id), 'admin'); }

  @Get('disputes') async disputes() {
    const list = await this.db.dispute.findMany({
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 100,
      include: { job: { select: { id: true, service: true, finalAmount: true, total: true, cancelFee: true, status: true, customer: { select: { name: true, phone: true } }, provider: { select: { userId: true, user: { select: { name: true } } } } } } },
    });
    return list.map(d => ({
      id: d.id, reason: d.reason, details: d.details, status: d.status, resolution: d.resolution, refundAmount: d.refundAmount, createdAt: d.createdAt, resolvedAt: d.resolvedAt,
      job: { id: d.job.id, service: d.job.service, status: d.job.status, amount: d.job.finalAmount ?? d.job.total, maxRefund: (d.job.finalAmount ?? 0) + d.job.cancelFee },
      customer: d.job.customer, provider: d.job.provider ? { id: d.job.provider.userId, name: d.job.provider.user.name } : null,
    }));
  }
  @Post('disputes/:id/resolve') @HttpCode(200) resolve(@Param('id') id: string, @Body() b: ResolveDisputeDto) { return this.jobSvc.resolveDispute(id, b.resolution, b.refundAmount); }

  @Post('providers/:id/suspend') @HttpCode(200) async suspend(@Param('id') id: string, @Body() b: SuspendDto) {
    const p = await this.db.provider.findUnique({ where: { userId: id } });
    if (!p) throw new NotFoundException('Provider not found');
    const upd = await this.db.provider.update({ where: { userId: id }, data: { suspended: b.suspended, ...(b.suspended ? { online: false } : {}) } });
    if (b.suspended) await this.geo.index.remove(id); // an active job (if any) is left to finish; no new offers
    this.push.notify(id, b.suspended
      ? { title: 'Account suspended', body: b.reason ? `Reason: ${b.reason}. Contact partner support.` : 'Contact OnSpot partner support for details.', data: { type: 'account' } }
      : { title: 'Account reinstated', body: 'You can go online again.', data: { type: 'account' } });
    return { id, suspended: upd.suspended };
  }

  @Get('overview') async overview() {
    const [byStatus, paid, matched, failed, online, providers, pendingKyc, openDisputes, lateNow] = await Promise.all([
      this.db.job.groupBy({ by: ['status'], _count: true }),
      this.db.job.findMany({ where: { status: 'PAID' }, select: { finalAmount: true, platformFee: true } }),
      this.db.job.findMany({ where: { assignedAt: { not: null } }, select: { createdAt: true, assignedAt: true } }),
      this.db.job.count({ where: { status: 'NO_PROVIDER' } }),
      this.db.provider.count({ where: { online: true } }),
      this.db.provider.count(),
      this.db.provider.count({ where: { kycStatus: 'SUBMITTED' } }),
      this.db.dispute.count({ where: { status: 'OPEN' } }),
      this.db.job.count({ where: { status: 'ASSIGNED', lateAt: { not: null } } }),
    ]);
    const count = (s: string) => byStatus.find(x => x.status === s)?._count ?? 0;
    const gmv = paid.reduce((t, j) => t + (j.finalAmount ?? 0), 0);
    const revenue = Math.round(paid.reduce((t, j) => t + j.platformFee + ((j.finalAmount ?? 0) - j.platformFee) * PRICING.commission, 0));
    const avgMatchSec = matched.length ? Math.round(matched.reduce((t, j) => t + (j.assignedAt!.getTime() - j.createdAt.getTime()), 0) / matched.length / 1000) : 0;
    return {
      active: ACTIVE_STATUSES.reduce((t, s) => t + count(s), 0), completed: count('COMPLETED') + count('PAID'), noProvider: failed,
      matchRate: matched.length + failed ? Math.round((matched.length / (matched.length + failed)) * 100) : 0,
      avgMatchSec, gmv, revenue, online, providers, pendingKyc, openDisputes, lateNow, geoIndex: this.geo.index.kind,
    };
  }
  @Get('providers') async providers() {
    const list = await this.db.provider.findMany({ include: { user: true }, orderBy: { updatedAt: 'desc' } });
    return list.map(p => ({ id: p.userId, name: p.user.name, phone: p.user.phone, services: p.services, vehicleNo: p.vehicleNo, online: p.online, onJob: !!p.activeJobId, rating: +p.rating.toFixed(2), ratingCount: p.ratingCount, jobsDone: p.jobsDone, earnings: p.earnings, kycStatus: p.kycStatus, kycDocs: p.kycDocs, suspended: p.suspended, lat: p.lat, lng: p.lng, trust: trustOf(p) }));
  }
  @Post('providers/:id/kyc') @HttpCode(200) async kyc(@Param('id') id: string, @Body() b: KycDecisionDto) {
    const p = await this.db.provider.findUnique({ where: { userId: id } });
    if (!p) throw new NotFoundException('Provider not found');
    if (p.kycStatus !== 'SUBMITTED') throw new BadRequestException('Nothing to review');
    const upd = await this.db.provider.update({ where: { userId: id }, data: { kycStatus: b.approve ? 'VERIFIED' : 'REJECTED' } });
    this.rt.toUser(id, EVENTS.KYC_UPDATED, { status: upd.kycStatus });
    this.push.notify(id, b.approve
      ? { title: "You're verified", body: 'Your KYC is approved. Go online to start getting jobs.', data: { type: 'kyc' } }
      : { title: 'KYC needs another look', body: 'Please check your details and resubmit in the app.', data: { type: 'kyc' } });
    return { id, kycStatus: upd.kycStatus };
  }
  @Get('jobs') async jobs() {
    return this.db.job.findMany({ orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, status: true, service: true, total: true, finalAmount: true, createdAt: true, pickupLat: true, pickupLng: true, customer: { select: { name: true } }, provider: { select: { user: { select: { name: true } } } } } });
  }
}
