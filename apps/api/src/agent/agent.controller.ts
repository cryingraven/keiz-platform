import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  agentDecisionQuerySchema,
  agentPolicySchema,
  AgentPolicyInput,
  proposeAgentPaymentSchema,
  ProposeAgentPaymentInput,
} from '@keiz/shared';
import { Roles } from '../common/roles.decorator';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodBody } from '../common/zod-body';
import { AgentService } from './agent.service';

@Controller('agent')
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  @Get('wallet')
  wallet(@CurrentUser() user: AuthUser) {
    return this.agent.getWallet(user.orgId, user.role as 'OWNER' | 'ADMIN' | 'APPROVER' | 'MEMBER');
  }

  @Roles('ADMIN', 'OWNER')
  @Post('wallet')
  createWallet(@CurrentUser() user: AuthUser) {
    return this.agent.getOrCreateWallet(user.orgId);
  }

  @Roles('OWNER')
  @Roles('OWNER')
  @Post('wallet/custody')
  createCustodyWallet(@CurrentUser() user: AuthUser) {
    return this.agent.createCustodyWallet(user.orgId);
  }

  @Patch('wallet/policy')
  updatePolicy(
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(agentPolicySchema)) body: AgentPolicyInput,
  ) {
    return this.agent.updatePolicy(user.orgId, body);
  }

  @Get('stats')
  stats(@CurrentUser() user: AuthUser) {
    return this.agent.stats(user.orgId);
  }

  @Get('actions')
  actions(@CurrentUser() user: AuthUser) {
    return this.agent.listActions(user.orgId);
  }

  @Post('actions')
  propose(
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(proposeAgentPaymentSchema)) body: ProposeAgentPaymentInput,
  ) {
    return this.agent.propose(user.orgId, body);
  }

  @Roles('ADMIN', 'OWNER')
  @Post('actions/:id/decision')
  decide(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query(new ZodBody(agentDecisionQuerySchema)) query: { decision: 'APPROVE' | 'REJECT' },
  ) {
    return this.agent.decide(user.orgId, user.sub, id, query.decision);
  }

  @Roles('ADMIN', 'OWNER')
  @Post('actions/:id/execute')
  execute(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.agent.execute(user.orgId, user.sub, user.accountId, id);
  }
}
