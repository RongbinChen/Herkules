import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  try {
    // Check if admin user already exists
    const existingAdmin = await prisma.user.findUnique({
      where: { email: 'rongbin.chen@waldrich-siegen.com' }
    });

    if (existingAdmin) {
      console.log('Admin user already exists: rongbin.chen@waldrich-siegen.com');
      return;
    }

    // Create admin user
    const hashedPassword = await bcrypt.hash('Chen198231', 10);
    const adminUser = await prisma.user.create({
      data: {
        email: 'rongbin.chen@waldrich-siegen.com',
        password: hashedPassword,
        name: 'Rongbin Chen',
        isAdmin: true
      }
    });

    console.log('✅ Admin user created successfully:');
    console.log(`   Email: ${adminUser.email}`);
    console.log(`   Name: ${adminUser.name}`);
    console.log(`   Admin: ${adminUser.isAdmin}`);
    console.log(`   ID: ${adminUser.id}`);
  } catch (error) {
    console.error('Error during seed:', error);
    throw error;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
