import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { AuthChallenge, AuthChallengeSchema } from './auth-challenge.schema';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { NearVerifyService } from './near-verify.service';
import { NearAuthService } from './near-auth.service';

@Module({
  imports: [
    UsersModule,
    MongooseModule.forFeature([{ name: AuthChallenge.name, schema: AuthChallengeSchema }]),
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, NearVerifyService, NearAuthService],
  exports: [NearVerifyService, NearAuthService],
})
export class AuthModule {}
