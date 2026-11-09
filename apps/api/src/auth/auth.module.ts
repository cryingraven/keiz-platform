import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { AuthChallenge, AuthChallengeSchema } from './auth-challenge.schema';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { NearVerifyService } from './near-verify.service';
import { PasskeyController } from './webauthn/passkey.controller';
import { PasskeyService } from './webauthn/passkey.service';
import {
  WebAuthnChallenge,
  WebAuthnChallengeSchema,
} from './webauthn/webauthn-challenge.schema';
import {
  WebAuthnCredential,
  WebAuthnCredentialSchema,
} from './webauthn/webauthn-credential.schema';

@Module({
  imports: [
    UsersModule,
    MongooseModule.forFeature([
      { name: AuthChallenge.name, schema: AuthChallengeSchema },
      { name: WebAuthnChallenge.name, schema: WebAuthnChallengeSchema },
      { name: WebAuthnCredential.name, schema: WebAuthnCredentialSchema },
    ]),
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [AuthController, PasskeyController],
  providers: [AuthService, NearVerifyService, PasskeyService],
  exports: [NearVerifyService, PasskeyService],
})
export class AuthModule {}
