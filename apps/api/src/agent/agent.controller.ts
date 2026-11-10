import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  agentDecisionQuerySchema,
  agentPolicySchema,
  AgentPolicyInput,
  hireAgentSchema,
  HireAgentInput,
  proposeAgentPaymentSchema,
  ProposeAgentPaymentInput,
} from '@keiz/shared';
import { Roles } from '../common/roles.decorator';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ZodBody } from '../common/zod-body';
import { AgentJobsService } from './agent-jobs.service';
import { AgentService } from './agent.service';

@Controller('agent')
export class AgentController {
  constructor(
    private readonly agent: AgentService,
    private readonly jobs: AgentJobsService,
  ) {}

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
  @Post('wallet/custody')
  createCustodyWallet(@CurrentUser() user: AuthUser) {
    return this.agent.createCustodyWallet(user.orgId);
  }

  @Roles('OWNER')
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

  @Get('providers')
  providers() {
    return this.jobs.listProviders();
  }

  @Get('jobs')
  agentJobs(@CurrentUser() user: AuthUser) {
    return this.jobs.listJobs(user.orgId);
  }

  @Get('jobs/:id')
  agentJob(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.getJob(user.orgId, id);
  }

  @Roles('ADMIN', 'OWNER')
  @Post('jobs')
  hire(
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(hireAgentSchema)) body: HireAgentInput,
  ) {
    return this.jobs.hire(user.orgId, user.sub, body);
  }

  @Roles('ADMIN', 'OWNER')
  @Post('jobs/:id/approve')
  approveJob(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.approve(user.orgId, user.sub, id);
  }

  @Roles('ADMIN', 'OWNER')
  @Post('jobs/:id/execute')
  executeJob(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.execute(user.orgId, user.sub, id);
  }

  @Roles('ADMIN', 'OWNER')
  @Post('jobs/:id/cancel')
  cancelJob(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.cancel(user.orgId, id);
  }
}
