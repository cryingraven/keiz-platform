import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateVendorInput, UpdateVendorInput } from '@keiz/shared';
import { Vendor, VendorDocument } from './vendor.schema';

@Injectable()
export class VendorsService {
  constructor(@InjectModel(Vendor.name) private readonly vendors: Model<VendorDocument>) {}

  list(orgId: string) {
    return this.vendors.find({ orgId, status: 'ACTIVE' }).sort({ createdAt: -1 }).lean();
  }

  create(orgId: string, input: CreateVendorInput) {
    return this.vendors.create({
      ...input,
      nearAccountId: input.nearAccountId || undefined,
      orgId,
    });
  }

  async findOne(orgId: string, id: string) {
    const vendor = await this.vendors.findOne({ _id: id, orgId }).lean();
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor;
  }

  async update(orgId: string, id: string, input: UpdateVendorInput) {
    const vendor = await this.vendors.findOneAndUpdate(
      { _id: id, orgId },
      {
        $set: {
          ...input,
          nearAccountId: input.nearAccountId || undefined,
        },
      },
      { returnDocument: 'after' },
    );
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor.toObject();
  }

  async archive(orgId: string, id: string) {
    const vendor = await this.vendors.findOneAndUpdate(
      { _id: id, orgId },
      { $set: { status: 'ARCHIVED' } },
      { returnDocument: 'after' },
    );
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor.toObject();
  }
}
