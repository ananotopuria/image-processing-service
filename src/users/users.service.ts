import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({
      email: email.toLowerCase(),
    });
  }

  async findEmailsByIds(ids: Types.ObjectId[]) {
    return this.userModel
      .find({ _id: { $in: ids } })
      .select('_id email')
      .lean()
      .exec();
  }

  async findByEmailWithPassword(email: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({
        email: email.toLowerCase(),
      })
      .select('+password');
  }

  async create(
    username: string,
    email: string,
    hashedPassword: string,
  ): Promise<UserDocument> {
    return this.userModel.create({
      username,
      email: email.toLowerCase(),
      password: hashedPassword,
    });
  }
}
